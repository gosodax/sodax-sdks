---
name: sodax-wallet-sdk-core-stellar
description: 'Granular skill for the @sodax/wallet-sdk-core v2 Stellar wallet provider only — `StellarWalletProvider` (backed by @stellar/stellar-sdk: Horizon only — classic Transaction signing + Horizon.Server polling). Use when a backend / Node script / CI / bot / non-React browser flow needs to instantiate a Stellar provider directly and sign XDR transactions — e.g. "instantiate StellarWalletProvider", "sign XDR in Node", "Stellar private-key signing", "waitForTransactionReceipt poll tuning". Covers BOTH integration (write new v2 code) and migration (port v1 — almost a no-op at this surface: deep-import → barrel). Picks via Step 1. Links into the parent sodax-wallet-sdk-core knowledge tree. For React dapps use the sodax-wallet-sdk-react skill instead (get the typed provider via useWalletProvider).'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Stellar (`wallet-sdk-core` granular skill)

Granular skill for `StellarWalletProvider` — the low-level Stellar wallet for backend / Node / non-React flows. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?** New → § Integration. Port v1 → § Migration (almost always a no-op here).
2. **Private-key or browser-extension config?** Stellar discriminates by an **explicit uppercase `type`** (`'PRIVATE_KEY'` | `'BROWSER_EXTENSION'`). PK = `{ type: 'PRIVATE_KEY', privateKey, network, rpcUrl? }`; browser-extension = `{ type: 'BROWSER_EXTENSION', walletsKit, network }` (Freighter / xBull / Lobstr). `network` is `'TESTNET' | 'PUBLIC'`.
3. **Mainnet confirmation?** Tune `defaults.pollInterval` / `pollTimeout` — keep `pollTimeout` ≥ 30 000 ms on mainnet.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — `BaseWalletProvider`, dual-config discriminants, shallow `defaults` merge, library-exports.
3. [`../integration/knowledge/features/stellar.md`](../integration/knowledge/features/stellar.md) — full config union, `StellarWalletDefaults`, `StellarWalletsKit` shape, methods (`signTransaction` / `waitForTransactionReceipt`), gotchas.
4. Setup recipe → [`../integration/knowledge/recipes/setup-private-key.md`](../integration/knowledge/recipes/setup-private-key.md) or [`../integration/knowledge/recipes/setup-browser-extension.md`](../integration/knowledge/recipes/setup-browser-extension.md); then [`../integration/knowledge/recipes/sign-and-broadcast.md`](../integration/knowledge/recipes/sign-and-broadcast.md), [`../integration/knowledge/recipes/defaults-and-overrides.md`](../integration/knowledge/recipes/defaults-and-overrides.md).
5. Lookups → [`../integration/knowledge/reference/provider-classes.md`](../integration/knowledge/reference/provider-classes.md), [`interfaces.md`](../integration/knowledge/reference/interfaces.md), [`chain-support.md`](../integration/knowledge/reference/chain-support.md).

### Stellar-specific anti-patterns

- **Forgetting the `type` discriminant.** Stellar and Bitcoin use an **uppercase `type` field** — every other chain uses field presence.
- **Mutating `networkPassphrase` directly.** It's derived from `network` and is private — override only via `defaults.networkPassphrase` (FUTURENET / private nets).
- **Setting `pollTimeout` too low on mainnet.** Confirmation typically takes 5–30 s; a low timeout surfaces false negatives.
- **Treating XDR as anything but a string.** Both tx input and signed output are `XDR` strings (alias from `@sodax/types`).
- **Mixing PK + browser-extension fields.** Discriminated union — don't `as`.

## Migration workflow (port v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — headline: **v1 code drops in unchanged at this surface**.
2. Only mechanical change: deep-import → barrel ([`../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md`](../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md)). Optionally adopt `defaults` ([`defaults-config.md`](../migration-v1-to-v2/knowledge/breaking-changes/defaults-config.md)) / re-imported library types ([`library-exports.md`](../migration-v1-to-v2/knowledge/breaking-changes/library-exports.md)).
3. Compile errors on `@sodax/sdk` / `@sodax/types` symbols → not this migration; load the `sodax-sdk` skill (migration mode).

## Verification

1. `pnpm tsc --noEmit` exits clean.
2. Config sets `type` and uses exactly one variant.
3. No v1 deep imports from `@sodax/wallet-sdk-core/wallet-providers/` (migration only).

## Related skills (same family)

Sibling chain skills follow the same shape — evm, solana, sui, bitcoin, icon, injective, near, stacks, tron. For multi-chain or undecided work, load the broad [`sodax-wallet-sdk-core` skill](../SKILL.md).

## Passing the provider into the SDK (different package family)

This skill *builds* the provider. For the concrete handoff, see [`../integration/knowledge/recipes/bridge-to-sdk.md`](../integration/knowledge/recipes/bridge-to-sdk.md). To execute SODAX operations, **also load the `sodax-sdk` skill (integration mode)** and pass it as `{ raw: false, walletProvider }`. React dapps get the provider via `useWalletProvider(...)` — **load the `sodax-wallet-sdk-react` skill** instead.
