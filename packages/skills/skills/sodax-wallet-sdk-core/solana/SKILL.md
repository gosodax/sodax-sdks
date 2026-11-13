---
name: sodax-wallet-sdk-core-solana
description: 'Granular skill for the @sodax/wallet-sdk-core v2 Solana wallet provider only — `SolanaWalletProvider` (backed by @solana/web3.js + wallet-adapter interfaces). Use when a backend / Node script / CI / bot / non-React browser flow needs to instantiate a Solana provider directly and sign + broadcast — e.g. "instantiate SolanaWalletProvider", "private-key Solana signing in Node", "build a v0 transaction", "sendTransactionWithConfirmation". Covers BOTH integration (write new v2 code) and migration (port v1 — almost a no-op at this surface: deep-import → barrel). Picks via Step 1. Links into the parent sodax-wallet-sdk-core knowledge tree. For React dapps use the sodax-wallet-sdk-react skill instead (get the typed provider via useWalletProvider).'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Solana (`wallet-sdk-core` granular skill)

Granular skill for `SolanaWalletProvider` — the low-level Solana wallet for backend / Node / non-React flows. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?** New → § Integration. Port v1 → § Migration (almost always a no-op here).
2. **Private-key or browser-extension config?** Solana discriminates by **field presence** (no `type`): PK = `{ privateKey: Uint8Array, endpoint }` (Node / CI / bots); browser-extension = `{ wallet: WalletContextState, endpoint }`. Mutually exclusive — pick one.
3. **Need confirmation?** `sendTransaction` fires-and-returns the signature; `sendTransactionWithConfirmation` waits (default `confirmCommitment: 'finalized'`).

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — `BaseWalletProvider`, dual-config discriminants, shallow `defaults` merge, library-exports.
3. [`../integration/knowledge/features/solana.md`](../integration/knowledge/features/solana.md) — full config union, `SolanaWalletDefaults`, methods (`buildV0Txn` / `sendTransaction` / `sendTransactionWithConfirmation` / `getAssociatedTokenAddress`), gotchas.
4. Setup recipe → [`../integration/knowledge/recipes/setup-private-key.md`](../integration/knowledge/recipes/setup-private-key.md) or [`../integration/knowledge/recipes/setup-browser-extension.md`](../integration/knowledge/recipes/setup-browser-extension.md); then [`../integration/knowledge/recipes/sign-and-broadcast.md`](../integration/knowledge/recipes/sign-and-broadcast.md), [`../integration/knowledge/recipes/defaults-and-overrides.md`](../integration/knowledge/recipes/defaults-and-overrides.md).
5. Lookups → [`../integration/knowledge/reference/provider-classes.md`](../integration/knowledge/reference/provider-classes.md), [`interfaces.md`](../integration/knowledge/reference/interfaces.md), [`chain-support.md`](../integration/knowledge/reference/chain-support.md).

### Solana-specific anti-patterns

- **Mixing PK + browser-extension fields.** Discriminated union — don't `as` across variants.
- **Constructing transactions yourself.** `buildV0Txn` is the canonical path — it picks the keypair-vs-adapter signing route internally based on construction mode.
- **Forgetting `endpoint`.** It's required in both modes — unlike EVM there is **no public-RPC fallback**.
- **Assuming `WalletContextState.signTransaction` exists.** It may be `undefined` (mirrors wallet-adapter); the provider throws at signing time if missing.
- **Expecting `defaults` to deep-merge.** Shallow; and `connectionConfig` overrides `connectionCommitment` if both set.

## Migration workflow (port v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — headline: **v1 code drops in unchanged at this surface**.
2. Only mechanical change: deep-import → barrel ([`../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md`](../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md)). Optionally adopt `defaults` ([`defaults-config.md`](../migration-v1-to-v2/knowledge/breaking-changes/defaults-config.md)) / re-imported library types ([`library-exports.md`](../migration-v1-to-v2/knowledge/breaking-changes/library-exports.md)).
3. Compile errors on `@sodax/sdk` / `@sodax/types` symbols → not this migration; load the `sodax-sdk` skill (migration mode).

## Verification

1. `pnpm tsc --noEmit` exits clean.
2. Config uses exactly one discriminant variant.
3. No v1 deep imports from `@sodax/wallet-sdk-core/wallet-providers/` (migration only).

## Related skills (same family)

Sibling chain skills follow the same shape — evm, sui, bitcoin, stellar, icon, injective, near, stacks, tron. For multi-chain or undecided work, load the broad [`sodax-wallet-sdk-core` skill](../SKILL.md).

## Passing the provider into the SDK (different package family)

This skill *builds* the provider. For the concrete handoff, see [`../integration/knowledge/recipes/bridge-to-sdk.md`](../integration/knowledge/recipes/bridge-to-sdk.md). To execute SODAX operations, **also load the `sodax-sdk` skill (integration mode)** and pass it as `{ raw: false, walletProvider }`. React dapps get the provider via `useWalletProvider(...)` — **load the `sodax-wallet-sdk-react` skill** instead.
