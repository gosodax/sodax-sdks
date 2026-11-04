---
name: sodax-wallet-sdk-react-wallet-modal
description: 'Granular skill for the @sodax/wallet-sdk-react v2 headless wallet-modal + multi-chain UI primitives only — useWalletModal (chainSelect → walletSelect → connecting → success | error state machine), useConnectionFlow (connect without a modal), useChainGroups, useConnectedChains, useBatchConnect / useBatchDisconnect, and the sortConnectors utility. Use when a React dapp needs a multi-chain wallet picker modal, an inline connection flow, batch connect/disconnect across chains, or chain/connector list rendering — e.g. "build a wallet modal", "useWalletModal", "multi-chain connect UI", "connect all chains with one wallet", "useBatchConnect". Covers BOTH integration (write new v2 code) and migration (port v1). Picks via Step 1. Links into the parent sodax-wallet-sdk-react knowledge tree. For a plain connect button use the sibling connect skill.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Wallet modal (`wallet-sdk-react` granular skill)

Granular skill for the headless multi-chain modal + connection-flow + batch hooks of `@sodax/wallet-sdk-react` v2 — render-agnostic, wallet-agnostic building blocks. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?** New → § Integration. Port v1 → § Migration.
2. **Which primitive?** Full modal state machine (`useWalletModal`), modal-less inline flow (`useConnectionFlow`), chain/connection lists (`useChainGroups` / `useConnectedChains`), or bulk ops (`useBatchConnect` / `useBatchDisconnect`).
3. **Need a render?** These hooks are render-agnostic — you own the JSX (the hooks supply state + actions; you map them to your components).

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../integration/knowledge/recipes/setup.md`](../integration/knowledge/recipes/setup.md) — prerequisite: mount `SodaxWalletProvider`, declare chain-type slots, wire React Query.
3. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — frozen config, EVM single-connection model, persist hydration gate.
4. [`../integration/knowledge/recipes/multi-chain-modal.md`](../integration/knowledge/recipes/multi-chain-modal.md) and [`../integration/knowledge/recipes/batch-operations.md`](../integration/knowledge/recipes/batch-operations.md).
5. Lookups → [`../integration/knowledge/reference/hooks.md`](../integration/knowledge/reference/hooks.md) (modal / multi-chain section), [`connectors.md`](../integration/knowledge/reference/connectors.md), [`wallet-brands.md`](../integration/knowledge/reference/wallet-brands.md).

### Modal-specific anti-patterns

- **Rendering UI before persist hydration.** Gate on `useConnectedChains().status === 'ready'` — render too early and you get flicker / stale state.
- **Expecting per-network EVM rows.** `useChainGroups` collapses every configured EVM network into a single `EVM` group (one wagmi connection covers all).
- **Ignoring the batch result buckets.** Both `useBatchConnect` and `useBatchDisconnect` return `successful` / `failed` (with per-chain error). Only `useBatchConnect` adds a `skipped` bucket (when `skipConnected: true`) — `BatchDisconnectResult` has no `skipped`. Surface every bucket the operation exposes.
- **Treating `useWalletModal` as connection state.** It's a UI state machine (`closed → chainSelect → walletSelect → connecting → success | error`); the connection itself comes from `useXAccount` / `useConnectedChains`.

## Migration workflow (port v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../migration-v1-to-v2/knowledge/breaking-changes.md`](../migration-v1-to-v2/knowledge/breaking-changes.md) — `useXWagmiStore` removed; single-object hook params; reshaped `SodaxWalletProvider` props.
3. [`../migration-v1-to-v2/knowledge/recipes/multi-chain-modal.md`](../migration-v1-to-v2/knowledge/recipes/multi-chain-modal.md) — v1 modal → v2 primitives.
4. Symbol lookups → [`../migration-v1-to-v2/knowledge/reference/hooks.md`](../migration-v1-to-v2/knowledge/reference/hooks.md).

## Verification

1. `pnpm tsc --noEmit` exits clean.
2. UI is gated on `useConnectedChains().status === 'ready'`.
3. Batch flows surface `failed` (and `skipped`) buckets, not just `successful`.
4. `grep -rE 'useXWagmiStore|useXWalletStore' src/` is empty (migration only).

## Related skills (same family)

- [`../connect/SKILL.md`](../connect/SKILL.md) — a plain connect/disconnect button + account reads (no modal).
- [`../walletconnect/SKILL.md`](../walletconnect/SKILL.md) — add Fireblocks / Ledger / mobile wallets to the modal.

For multi-feature work, load the broad [`sodax-wallet-sdk-react` skill](../SKILL.md).
