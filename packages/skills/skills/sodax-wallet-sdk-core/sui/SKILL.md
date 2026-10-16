---
name: sodax-wallet-sdk-core-sui
description: 'Granular skill for the @sodax/wallet-sdk-core v2 Sui wallet provider only — `SuiWalletProvider` (backed by @mysten/sui over gRPC). Use when a backend / Node script / CI / bot / non-React browser flow needs to instantiate a Sui provider directly and sign + execute — e.g. "instantiate SuiWalletProvider", "Sui signing from a mnemonic in Node", "signAndExecuteTxn with dry-run". Covers BOTH integration (write new v2 code) and migration (port v1 — private-key mode is near mechanical, but browser-extension mode is a hard break: `{client, wallet, account}` becomes `{grpcUrl, address, signTransaction}`). Picks via Step 1. Links into the parent sodax-wallet-sdk-core knowledge tree. For React dapps use the sodax-wallet-sdk-react skill instead (get the typed provider via useWalletProvider).'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Sui (`wallet-sdk-core` granular skill)

Granular skill for `SuiWalletProvider` — the low-level Sui wallet for backend / Node / non-React flows. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?** New → § Integration. Port v1 → § Migration (mechanical for private-key mode; browser-extension mode must be rewritten).
2. **Private-key or browser-extension config?** Sui discriminates by **field presence** (no `type`) but the PK credential is a **`mnemonics`** string (BIP-39), not a raw key: PK = `{ grpcUrl, mnemonics }`; browser-extension = `{ grpcUrl, address, signTransaction }`. Mutually exclusive — pick one. `rpcUrl` is still accepted as a deprecated alias for `grpcUrl`. Exactly one of the two must be present — passing both throws.
3. **Dry-run?** `signAndExecuteTxn` runs a pre-flight dry-run **on by default**; disable only when paying gas for a doomed tx is acceptable.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — `BaseWalletProvider`, dual-config discriminants, shallow `defaults` merge, library-exports.
3. [`../integration/knowledge/features/sui.md`](../integration/knowledge/features/sui.md) — full config union, `SuiWalletDefaults`, methods (`signAndExecuteTxn` / `viewContract` / `getCoins`), gotchas.
4. Setup recipe → [`../integration/knowledge/recipes/setup-private-key.md`](../integration/knowledge/recipes/setup-private-key.md) or [`../integration/knowledge/recipes/setup-browser-extension.md`](../integration/knowledge/recipes/setup-browser-extension.md); then [`../integration/knowledge/recipes/sign-and-broadcast.md`](../integration/knowledge/recipes/sign-and-broadcast.md), [`../integration/knowledge/recipes/defaults-and-overrides.md`](../integration/knowledge/recipes/defaults-and-overrides.md).
5. Lookups → [`../integration/knowledge/reference/provider-classes.md`](../integration/knowledge/reference/provider-classes.md), [`interfaces.md`](../integration/knowledge/reference/interfaces.md), [`chain-support.md`](../integration/knowledge/reference/chain-support.md).

### Sui-specific anti-patterns

- **Passing a raw private key.** The PK variant accepts only a `mnemonics` phrase — the library derives the Ed25519 keypair. There is no raw-secret-key constructor.
- **Assigning `dAppKit.signTransaction` straight to `signTransaction`.** The config's callback takes the transaction positionally; dApp Kit's and wallet-standard's signers are options-shaped. Wrap it, and name the account — otherwise it signs with whichever one is connected, not the `address` you passed.
- **Disabling dry-run by default.** It's on for safety — production scripts almost never want `{ dryRun: { enabled: false } }`.
- **Mixing PK + browser-extension fields.** Discriminated union — don't `as`.

## Migration workflow (port v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — headline: **private-key v1 code drops in nearly unchanged; browser-extension code does not**.
2. **Browser-extension mode must be rewritten**: `{ client, wallet, account }` → `{ grpcUrl, address, signTransaction }`, and the endpoint must speak gRPC-web. `rpcUrl` survives as a deprecated alias for `grpcUrl`; `SuiSignAndExecutePolicy.response` is gone. See [`../integration/knowledge/features/sui.md`](../integration/knowledge/features/sui.md) for the new config and the signer wrapper.
3. Otherwise mechanical: deep-import → barrel ([`../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md`](../migration-v1-to-v2/knowledge/breaking-changes/folder-layout.md)). Optionally adopt `defaults` ([`defaults-config.md`](../migration-v1-to-v2/knowledge/breaking-changes/defaults-config.md)) / re-imported library types ([`library-exports.md`](../migration-v1-to-v2/knowledge/breaking-changes/library-exports.md)).
4. Compile errors on `@sodax/sdk` / `@sodax/types` symbols → not this migration; load the `sodax-sdk` skill (migration mode).

## Verification

1. `pnpm tsc --noEmit` exits clean.
2. Config uses exactly one discriminant variant; browser-extension passes `grpcUrl` + `address` + a wrapped `signTransaction`.
3. No v1 deep imports from `@sodax/wallet-sdk-core/wallet-providers/` (migration only).

## Related skills (same family)

Sibling chain skills follow the same shape — evm, solana, bitcoin, stellar, icon, injective, near, stacks. For multi-chain or undecided work, load the broad [`sodax-wallet-sdk-core` skill](../SKILL.md).

## Passing the provider into the SDK (different package family)

This skill *builds* the provider. For the concrete handoff, see [`../integration/knowledge/recipes/bridge-to-sdk.md`](../integration/knowledge/recipes/bridge-to-sdk.md). To execute SODAX operations, **also load the `sodax-sdk` skill (integration mode)** and pass it as `{ raw: false, walletProvider }`. React dapps get the provider via `useWalletProvider(...)` — **load the `sodax-wallet-sdk-react` skill** instead.
