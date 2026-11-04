---
name: sodax-wallet-sdk-core-stacks
description: 'Granular skill for the @sodax/wallet-sdk-core v2 Stacks wallet provider only — `StacksWalletProvider` (backed by @stacks/transactions + @stacks/connect). Use when a backend / Node script / CI / bot / non-React browser flow needs to instantiate a Stacks provider directly and sign + broadcast — e.g. "instantiate StacksWalletProvider", "Stacks private-key signing in Node", "sendTransaction with post-conditions", "readContract Clarity value". Covers BOTH integration (write new v2 code) and migration (port v1 — almost a no-op at this surface: deep-import → barrel). Picks via Step 1. Links into the parent sodax-wallet-sdk-core knowledge tree. For React dapps use the sodax-wallet-sdk-react skill instead (get the typed provider via useWalletProvider).'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Stacks (`wallet-sdk-core` granular skill)

Granular skill for `StacksWalletProvider` — the low-level Stacks wallet for backend / Node / non-React flows. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?** New → § Integration. Port v1 → § Migration (almost always a no-op here).
2. **Private-key or browser-extension config?** Stacks discriminates by **field presence** (no `type`): PK = `{ privateKey, endpoint? }`; browser-extension = `{ address, endpoint?, provider? }` (Leather / Xverse / Asigna). Mutually exclusive — pick one.
3. **Network?** `defaults.network` is `'mainnet' | 'testnet'` (default `'mainnet'`); addresses are environment-specific (`SP…` vs `ST…`).

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — `BaseWalletProvider`, dual-config discriminants, shallow `defaults` merge, library-exports.
3. [`../integration/knowledge/features/stacks.md`](../integration/knowledge/features/stacks.md) — full config union, `StacksWalletDefaults`, methods (`sendTransaction` / `readContract` / `getBalance`), `PostConditionMode` enum, gotchas.
4. Setup recipe → [`../integration/knowledge/recipes/setup-private-key.md`](../integration/knowledge/recipes/setup-private-key.md) or [`../integration/knowledge/recipes/setup-browser-extension.md`](../integration/knowledge/recipes/setup-browser-extension.md); then [`../integration/knowledge/recipes/sign-and-broadcast.md`](../integration/knowledge/recipes/sign-and-broadcast.md), [`../integration/knowledge/recipes/library-exports.md`](../integration/knowledge/recipes/library-exports.md) (`PostConditionMode`), [`../integration/knowledge/recipes/defaults-and-overrides.md`](../integration/knowledge/recipes/defaults-and-overrides.md).
5. Lookups → [`../integration/knowledge/reference/provider-classes.md`](../integration/knowledge/reference/provider-classes.md), [`interfaces.md`](../integration/knowledge/reference/interfaces.md), [`chain-support.md`](../integration/knowledge/reference/chain-support.md).

### Stacks-specific anti-patterns

- **Adding `@stacks/transactions` as a direct dep for `PostConditionMode`.** It's re-exported as a runtime value from `@sodax/wallet-sdk-core` — import it from the barrel.
- **Crossing mainnet/testnet addresses.** `network: 'mainnet'` → `STACKS_MAINNET` (`SP…`); `'testnet'` → `STACKS_TESTNET` (`ST…`). Cross-environment addresses reject.
- **Assuming a `provider` is required in browser-extension mode.** It's optional — omitted, the provider falls back to the globally-injected `window` provider; pass it explicitly for tests / non-injected envs.
- **Mixing PK + browser-extension fields.** Discriminated union — don't `as`.

## Migration workflow (port v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — headline: **v1 code drops in unchanged at this surface**.
2. Only mechanical change: deep-import → barrel ([`../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md`](../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md)). Optionally adopt `defaults` ([`defaults-config.md`](../migration-v1-to-v2/knowledge/breaking-changes/defaults-config.md)) / re-imported library types ([`library-exports.md`](../migration-v1-to-v2/knowledge/breaking-changes/library-exports.md)).
3. Compile errors on `@sodax/sdk` / `@sodax/types` symbols → not this migration; load the `sodax-sdk` skill (migration mode).

## Verification

1. `pnpm tsc --noEmit` exits clean.
2. `PostConditionMode` imported from `@sodax/wallet-sdk-core`; config uses exactly one variant.
3. No v1 deep imports from `@sodax/wallet-sdk-core/wallet-providers/` (migration only).

## Related skills (same family)

Sibling chain skills follow the same shape — evm, solana, sui, bitcoin, stellar, icon, injective, near, tron. For multi-chain or undecided work, load the broad [`sodax-wallet-sdk-core` skill](../SKILL.md).

## Passing the provider into the SDK (different package family)

This skill *builds* the provider. For the concrete handoff, see [`../integration/knowledge/recipes/bridge-to-sdk.md`](../integration/knowledge/recipes/bridge-to-sdk.md). To execute SODAX operations, **also load the `sodax-sdk` skill (integration mode)** and pass it as `{ raw: false, walletProvider }`. React dapps get the provider via `useWalletProvider(...)` — **load the `sodax-wallet-sdk-react` skill** instead.
