---
name: sodax-wallet-sdk-core-near
description: 'Granular skill for the @sodax/wallet-sdk-core v2 NEAR wallet provider only — `NearWalletProvider` (backed by near-api-js for PK signing + @hot-labs/near-connect for browser flows). Use when a backend / Node script / CI / bot / non-React browser flow needs to instantiate a NEAR provider directly and sign + submit — e.g. "instantiate NearWalletProvider", "NEAR private-key signing in Node", "signAndSubmitTxn", "getRawTransaction for inspection". Covers BOTH integration (write new v2 code) and migration (port v1 — almost a no-op at this surface: deep-import → barrel). Picks via Step 1. Links into the parent sodax-wallet-sdk-core knowledge tree. For React dapps use the sodax-wallet-sdk-react skill instead (get the typed provider via useWalletProvider).'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# NEAR (`wallet-sdk-core` granular skill)

Granular skill for `NearWalletProvider` — the low-level NEAR wallet for backend / Node / non-React flows. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?** New → § Integration. Port v1 → § Migration (almost always a no-op here).
2. **Private-key or browser-extension config?** NEAR discriminates by **field presence** (no `type`): PK = `{ rpcUrl, accountId, privateKey }` where `privateKey` is the full `'ed25519:…'` string; browser-extension = `{ wallet: NearConnector }` (from `@hot-labs/near-connect`). Mutually exclusive — pick one.
3. **Finality vs speed?** `defaults.waitUntil` is `'FINAL'` by default — lower (`'EXECUTED'`) for faster scripts with the usual revert caveats.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — `BaseWalletProvider`, dual-config discriminants, shallow `defaults` merge, library-exports.
3. [`../integration/knowledge/features/near.md`](../integration/knowledge/features/near.md) — full config union, `NearWalletDefaults`, methods (`getRawTransaction` / `signAndSubmitTxn`), gotchas.
4. Setup recipe → [`../integration/knowledge/recipes/setup-private-key.md`](../integration/knowledge/recipes/setup-private-key.md) or [`../integration/knowledge/recipes/setup-browser-extension.md`](../integration/knowledge/recipes/setup-browser-extension.md); then [`../integration/knowledge/recipes/sign-and-broadcast.md`](../integration/knowledge/recipes/sign-and-broadcast.md), [`../integration/knowledge/recipes/defaults-and-overrides.md`](../integration/knowledge/recipes/defaults-and-overrides.md).
5. Lookups → [`../integration/knowledge/reference/provider-classes.md`](../integration/knowledge/reference/provider-classes.md), [`interfaces.md`](../integration/knowledge/reference/interfaces.md), [`chain-support.md`](../integration/knowledge/reference/chain-support.md).

### NEAR-specific anti-patterns

- **Passing only the key bytes.** `privateKey` is the full `'ed25519:…'` string (NEAR stores the algorithm prefix).
- **Omitting `accountId` in PK mode.** NEAR keys don't determine the account — accounts hold multiple keys, so both are required.
- **Passing a low-level wallet object in browser-extension mode.** Pass the `@hot-labs/near-connect` `NearConnector` — it already abstracts over Meteor / MyNearWallet / etc.
- **Reading `account` / `rpcProvider` in browser-extension mode.** Those public fields are PK-mode only.
- **Mixing PK + browser-extension fields.** Discriminated union — don't `as`.

## Migration workflow (port v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — headline: **v1 code drops in unchanged at this surface**.
2. Only mechanical change: deep-import → barrel ([`../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md`](../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md)). Optionally adopt `defaults` ([`defaults-config.md`](../migration-v1-to-v2/knowledge/breaking-changes/defaults-config.md)) / re-imported library types ([`library-exports.md`](../migration-v1-to-v2/knowledge/breaking-changes/library-exports.md)).
3. Compile errors on `@sodax/sdk` / `@sodax/types` symbols → not this migration; load the `sodax-sdk` skill (migration mode).

## Verification

1. `pnpm tsc --noEmit` exits clean.
2. PK config carries `accountId` + the prefixed `ed25519:` key; config uses exactly one variant.
3. No v1 deep imports from `@sodax/wallet-sdk-core/wallet-providers/` (migration only).

## Related skills (same family)

Sibling chain skills follow the same shape — evm, solana, sui, bitcoin, stellar, icon, injective, stacks, tron. For multi-chain or undecided work, load the broad [`sodax-wallet-sdk-core` skill](../SKILL.md).

## Passing the provider into the SDK (different package family)

This skill *builds* the provider. For the concrete handoff, see [`../integration/knowledge/recipes/bridge-to-sdk.md`](../integration/knowledge/recipes/bridge-to-sdk.md). To execute SODAX operations, **also load the `sodax-sdk` skill (integration mode)** and pass it as `{ raw: false, walletProvider }`. React dapps get the provider via `useWalletProvider(...)` — **load the `sodax-wallet-sdk-react` skill** instead.
