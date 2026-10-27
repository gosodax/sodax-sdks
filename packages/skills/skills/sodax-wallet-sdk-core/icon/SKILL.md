---
name: sodax-wallet-sdk-core-icon
description: 'Granular skill for the @sodax/wallet-sdk-core v2 ICON wallet provider only — `IconWalletProvider` (backed by icon-sdk-js; browser-extension mode talks to Hana via the ICONEX `CustomEvent` relay — an in-page message bridge). Use when a backend / Node script / CI / bot / non-React browser flow needs to instantiate an ICON provider directly and sign + broadcast — e.g. "instantiate IconWalletProvider", "ICON private-key signing in Node", "send an IcxCallTransaction", "Hana wallet bridge". Covers BOTH integration (write new v2 code) and migration (port v1 — almost a no-op at this surface: deep-import → barrel). Picks via Step 1. Links into the parent sodax-wallet-sdk-core knowledge tree. For React dapps use the sodax-wallet-sdk-react skill instead (get the typed provider via useWalletProvider).'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# ICON (`wallet-sdk-core` granular skill)

Granular skill for `IconWalletProvider` — the low-level ICON wallet for backend / Node / non-React flows. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?** New → § Integration. Port v1 → § Migration (almost always a no-op here).
2. **Private-key or browser-extension config?** ICON discriminates by **field presence** (no `type`): PK = `{ privateKey, rpcUrl }`; browser-extension = `{ walletAddress?, rpcUrl }` (talks to Hana via the ICONEX `CustomEvent` relay). `rpcUrl` is **required in both modes** — no public-RPC fallback.
3. **Scripted determinism?** In browser-extension mode supply `walletAddress` yourself — the consumer provides it (or resolves it via the exported `requestAddress` helper). The provider never auto-resolves it; `getWalletAddress()` throws `Error('Wallet not initialized')` if it isn't set.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — `BaseWalletProvider`, dual-config discriminants, shallow `defaults` merge, library-exports.
3. [`../integration/knowledge/features/icon.md`](../integration/knowledge/features/icon.md) — full config union, `IconWalletDefaults`, methods (`sendTransaction` / `waitForTransactionReceipt`), gotchas.
4. Setup recipe → [`../integration/knowledge/recipes/setup-private-key.md`](../integration/knowledge/recipes/setup-private-key.md) or [`../integration/knowledge/recipes/setup-browser-extension.md`](../integration/knowledge/recipes/setup-browser-extension.md); then [`../integration/knowledge/recipes/sign-and-broadcast.md`](../integration/knowledge/recipes/sign-and-broadcast.md), [`../integration/knowledge/recipes/defaults-and-overrides.md`](../integration/knowledge/recipes/defaults-and-overrides.md).
5. Lookups → [`../integration/knowledge/reference/provider-classes.md`](../integration/knowledge/reference/provider-classes.md), [`interfaces.md`](../integration/knowledge/reference/interfaces.md), [`chain-support.md`](../integration/knowledge/reference/chain-support.md).

### ICON-specific anti-patterns

- **Omitting `rpcUrl`.** Required in both modes — there is no provider-level public-RPC fallback.
- **Assuming millisecond timestamps.** `timestampProvider` returns **microseconds** (default `Date.now() * 1000`).
- **Firing many parallel browser-extension calls.** The ICONEX `CustomEvent` relay is one shared window channel; the SDK serializes requests so at most one is in flight and concurrent calls no longer cross-resolve. They run one at a time (a pending signing prompt blocks the next), and each call times out after ~5 min if the wallet never answers.
- **Treating a contract (`cx…`) as the signer.** The wallet level is EOA-only (`IconEoaAddress`, `hx…`); contracts appear in tx params, not as the signer.
- **Mixing PK + browser-extension fields.** Discriminated union — don't `as`.

## Migration workflow (port v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — headline: **v1 code drops in unchanged at this surface**.
2. Only mechanical change: deep-import → barrel ([`../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md`](../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md)). Optionally adopt `defaults` ([`defaults-config.md`](../migration-v1-to-v2/knowledge/breaking-changes/defaults-config.md)) / re-imported library types ([`library-exports.md`](../migration-v1-to-v2/knowledge/breaking-changes/library-exports.md)).
3. Compile errors on `@sodax/sdk` / `@sodax/types` symbols → not this migration; load the `sodax-sdk` skill (migration mode).

## Verification

1. `pnpm tsc --noEmit` exits clean.
2. `rpcUrl` is set; config uses exactly one discriminant variant.
3. No v1 deep imports from `@sodax/wallet-sdk-core/wallet-providers/` (migration only).

## Related skills (same family)

Sibling chain skills follow the same shape — evm, solana, sui, bitcoin, stellar, injective, near, stacks, tron. For multi-chain or undecided work, load the broad [`sodax-wallet-sdk-core` skill](../SKILL.md).

## Passing the provider into the SDK (different package family)

This skill *builds* the provider. For the concrete handoff, see [`../integration/knowledge/recipes/bridge-to-sdk.md`](../integration/knowledge/recipes/bridge-to-sdk.md). To execute SODAX operations, **also load the `sodax-sdk` skill (integration mode)** and pass it as `{ raw: false, walletProvider }`. React dapps get the provider via `useWalletProvider(...)` — **load the `sodax-wallet-sdk-react` skill** instead.
