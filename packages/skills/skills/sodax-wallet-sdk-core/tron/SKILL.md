---
name: sodax-wallet-sdk-core-tron
description: 'Granular skill for the @sodax/wallet-sdk-core v2 Tron wallet provider only — `TronWalletProvider` (no Tron SDK dependency: TronWeb is typed structurally and viem signs; browser-extension mode signs through the provider a wallet such as TronLink announces over TIP-6963). Use when a backend / Node script / CI / bot / non-React browser flow needs to instantiate a Tron provider directly and sign — e.g. "instantiate TronWalletProvider", "Tron private-key signing in Node", "TronLink signing outside React", "signMessageV2 withdrawal signature", "custom ITronWalletProvider". Covers integration (write new v2 code); Tron is new in v2, so there is no v1 code to migrate. Links into the parent sodax-wallet-sdk-core knowledge tree. For React dapps use the sodax-wallet-sdk-react skill instead (get the typed provider via useWalletProvider).'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Tron (`wallet-sdk-core` granular skill)

Granular skill for `TronWalletProvider` — the low-level Tron wallet for backend / Node / non-React flows. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

1. **New code only.** Tron is new in v2, so there is no v1 code to port — go to § Integration.
2. **Private-key or browser-extension config?** Tron discriminates by **field presence** (no `type`): PK = `{ privateKey }`; browser-extension = `{ tronWeb, getProvider }`, where `getProvider` returns the provider the wallet announced over TIP-6963. Mutually exclusive — pick one.
3. **`TronWalletProvider` or a custom `ITronWalletProvider`?** A custom `signMessage` must sign the hash the way `signMessageV2` does — see [`features/tron.md`](../integration/knowledge/features/tron.md) § Gotchas.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — `BaseWalletProvider`, dual-config discriminants, shallow `defaults` merge, library-exports.
3. [`../integration/knowledge/features/tron.md`](../integration/knowledge/features/tron.md) — config, RPC resolution, methods, the `signMessage` contract, gotchas.
4. Setup recipe → [`../integration/knowledge/recipes/setup-private-key.md`](../integration/knowledge/recipes/setup-private-key.md) or [`../integration/knowledge/recipes/setup-browser-extension.md`](../integration/knowledge/recipes/setup-browser-extension.md); then [`../integration/knowledge/recipes/sign-and-broadcast.md`](../integration/knowledge/recipes/sign-and-broadcast.md).
5. Lookups → [`../integration/knowledge/reference/provider-classes.md`](../integration/knowledge/reference/provider-classes.md), [`interfaces.md`](../integration/knowledge/reference/interfaces.md), [`chain-support.md`](../integration/knowledge/reference/chain-support.md).

### Tron-specific anti-patterns

- **Passing only `window.tronWeb` in browser-extension mode.** The injected global may not be the connected instance; pass `getProvider` so signing goes through the announced provider's TronWeb.
- **Capturing `provider` once instead of passing `getProvider`.** Which instance is connected is known only after TIP-6963 discovery resolves; `getProvider` re-resolves it on every call, while a captured `provider` can be stale.
- **Signing the raw hash bytes in a custom `signMessage`.** It must sign the hash's hex text (TronWeb `trx.signMessageV2`), or the signature recovers to a different address.
- **Reading a `waitForTransactionReceipt` result as success.** It resolves once the tx is in a block, reverted or not; check the returned `receipt?.result`.
- **Adding `tronweb` for the config types.** `TronWebLike` and `TronProviderLike` are exported from `@sodax/wallet-sdk-core`.
- **Mixing PK + browser-extension fields.** Discriminated union — don't `as`.

## Migration workflow (port v1 → v2)

Nothing to port: v1 has no Tron provider. A v1 project that adds Tron writes it as new code (§ Integration); for the rest of its port, load the broad [`sodax-wallet-sdk-core` skill](../SKILL.md) in migration mode.

## Verification

1. `pnpm tsc --noEmit` exits clean.
2. `getWalletAddress()` returns the base58 `T…` address; config uses exactly one variant.
3. A browser-extension config passes `getProvider` (or `provider`), not just `tronWeb`.

## Related skills (same family)

Sibling chain skills follow the same shape — evm, solana, sui, bitcoin, stellar, icon, injective, near, stacks. For multi-chain or undecided work, load the broad [`sodax-wallet-sdk-core` skill](../SKILL.md).

## Passing the provider into the SDK (different package family)

This skill *builds* the provider. For the concrete handoff, see [`../integration/knowledge/recipes/bridge-to-sdk.md`](../integration/knowledge/recipes/bridge-to-sdk.md). To execute SODAX operations, **also load the `sodax-sdk` skill (integration mode)** and pass it as `{ raw: false, walletProvider }`. React dapps get the provider via `useWalletProvider(...)` — **load the `sodax-wallet-sdk-react` skill** instead.
