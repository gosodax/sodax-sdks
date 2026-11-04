#!/usr/bin/env node
// Reports swap tokens the SDK lists as production-supported that the solver's price oracle does
// not carry — i.e. where `swapSupportedTokens` has run ahead of the solver.
//
// The public token tables are NOT generated from here: docs/developers/deployments/
// swaps-compatible-assets.md renders live from the backend config API, which is what actually
// makes a token fillable. This script answers the narrower question that has no other owner —
// "is the shipped SDK list ahead of the solver?" — so it is a manual/on-demand tool
// (`pnpm check:swap-tokens-oracle`) rather than a required CI gate: it depends on a live service
// outside this repo, and a solver-side outage must not block merges here.
//
// Usage:
//   pnpm check:swap-tokens-oracle [--oracle <url>] [--staging] [--json] [--no-fail]
//
//   --oracle <url>  Oracle endpoint (default https://api.sodax.com/v1/intent/oracle,
//                   or $ORACLE_URL). Response shape: docs/developers/http-api/oracle.mdx.
//   --staging       Expect the staging set (production + `stagingSwapSupportedTokens`) instead
//                   of production alone. Point --oracle at the staging solver when using this;
//                   no staging /oracle route is confirmed to serve this payload today.
//   --json          Emit the raw comparison instead of the text report.
//   --no-fail       Always exit 0 (report only).
//
// Only EVM chains count toward the exit code. Non-EVM addresses are spelled differently in the
// oracle than in the SDK (Sui zero-padding, Bitcoin hex, Stacks `::token` suffix), so a string
// match there is inconclusive in both directions — those chains are reported, never failed on.
// Confirm non-EVM promotions with the solver team.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ORACLE_URL = 'https://api.sodax.com/v1/intent/oracle';
const MAX_LISTED_EXTRAS = 10;

// ── Comparison (exported for check-swap-tokens-oracle.test.mjs) ───────────────

// Per-chain join of the SDK swap list against the oracle, keyed by RelayChainIdMap chain id and
// case-insensitive address. `missing` is what the SDK claims and the oracle lacks; `extra` is the
// reverse (informational — the oracle carries hub assets that are in no swap list).
export const compareTokensToOracle = ({ swapTokens, relayChainIdMap, chainInfo, oracle }) => {
  const byChainId = new Map();
  for (const entry of oracle) {
    const list = byChainId.get(String(entry.chainId)) ?? [];
    list.push(entry);
    byChainId.set(String(entry.chainId), list);
  }

  return Object.entries(swapTokens).map(([chainKey, tokens]) => {
    const info = chainInfo[chainKey];
    const chainId = relayChainIdMap[chainKey] === undefined ? '' : String(relayChainIdMap[chainKey]);
    const oracleTokens = byChainId.get(chainId) ?? [];
    const oracleAddresses = new Set(oracleTokens.map(t => String(t.address).toLowerCase()));
    const sdkAddresses = new Set(tokens.map(t => String(t.address).toLowerCase()));

    return {
      chainKey,
      name: info?.name ?? chainKey,
      // An unknown chain is treated as non-EVM: it must not fail the run on a guess.
      isEvm: info?.type === 'EVM',
      chainId,
      sdkCount: tokens.length,
      oracleCount: oracleTokens.length,
      missing: tokens.filter(t => !oracleAddresses.has(String(t.address).toLowerCase())),
      extra: oracleTokens.filter(t => !sdkAddresses.has(String(t.address).toLowerCase())),
    };
  });
};

// Drift is EVM-only — see the header note on non-EVM address formats.
export const driftCount = results => results.reduce((total, r) => total + (r.isEvm ? r.missing.length : 0), 0);

export const formatReport = results => {
  const lines = [];
  for (const r of [...results].sort((a, b) => a.name.localeCompare(b.name))) {
    if (r.sdkCount === 0) continue;
    const tag = r.isEvm ? '' : ' (non-EVM — not failed on)';
    lines.push(`${r.name} [${r.chainId}]${tag}: ${r.sdkCount} in SDK, ${r.oracleCount} in oracle`);
    if (r.missing.length > 0) {
      lines.push(`  missing from oracle: ${r.missing.map(t => `${t.symbol} (${t.address})`).join(', ')}`);
    }
    if (r.extra.length > 0) {
      const shown = r.extra.slice(0, MAX_LISTED_EXTRAS).map(t => t.symbol ?? t.address);
      const rest = r.extra.length - shown.length;
      lines.push(`  in oracle, not in this list: ${shown.join(', ')}${rest > 0 ? ` … and ${rest} more` : ''}`);
    }
  }
  return lines.join('\n');
};

// ── CLI ──────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const staging = args.includes('--staging');
  const asJson = args.includes('--json');
  const noFail = args.includes('--no-fail');
  const flagIndex = args.indexOf('--oracle');
  const oracleUrl = (flagIndex === -1 ? process.env.ORACLE_URL : args[flagIndex + 1]) || DEFAULT_ORACLE_URL;

  const typesUrl = new URL('../packages/types/dist/index.js', import.meta.url);
  let types;
  try {
    types = await import(typesUrl.href);
  } catch {
    console.error(
      'check-swap-tokens-oracle: @sodax/types is not built — run `pnpm --filter @sodax/types build` first.',
    );
    process.exit(1);
  }

  const { swapSupportedTokens, stagingSwapSupportedTokens, RelayChainIdMap, baseChainInfo } = types;
  const swapTokens = Object.fromEntries(
    Object.entries(swapSupportedTokens).map(([chainKey, tokens]) => [
      chainKey,
      staging ? [...tokens, ...(stagingSwapSupportedTokens[chainKey] ?? [])] : tokens,
    ]),
  );

  console.error(`check-swap-tokens-oracle: fetching ${oracleUrl}`);
  let oracle;
  try {
    const response = await fetch(oracleUrl, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`status ${response.status}`);
    oracle = await response.json();
  } catch (error) {
    console.error(`check-swap-tokens-oracle: could not read the oracle (${error.message})`);
    process.exit(1);
  }
  if (!Array.isArray(oracle) || oracle.length === 0) {
    console.error('check-swap-tokens-oracle: the oracle did not return a non-empty JSON array.');
    process.exit(1);
  }

  const results = compareTokensToOracle({
    swapTokens,
    relayChainIdMap: RelayChainIdMap,
    chainInfo: baseChainInfo,
    oracle,
  });
  const drift = driftCount(results);

  if (asJson) {
    console.log(JSON.stringify({ oracleUrl, staging, drift, results }, null, 2));
  } else {
    console.log(formatReport(results));
    console.log('');
    console.log(
      drift === 0
        ? `check-swap-tokens-oracle: no EVM drift against ${oracleUrl}`
        : `check-swap-tokens-oracle: ${drift} EVM token(s) in the ${staging ? 'staging' : 'production'} SDK list are absent from ${oracleUrl}`,
    );
  }

  if (drift > 0 && !noFail) process.exit(1);
}
