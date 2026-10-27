---
name: sodax-wallet-sdk-react-connect
description: 'Granular skill for the @sodax/wallet-sdk-react v2 core connect surface only — connect / disconnect, reading account + connection state, and connector discovery across chain types: useXConnect, useXDisconnect, useXAccount(s), useXConnection(s), useXConnectors, useXConnectorsByChain, useIsWalletInstalled, useEnabledChains. Use when a React dapp needs a connect/disconnect button, to read the connected address per chain, gate UI on connection, or list available wallets — e.g. "add a wallet connect button", "useXConnect", "useXAccount per chain", "is the wallet connected", "list connectors for EVM". Covers BOTH integration (write new v2 code) and migration (port v1 — single-object hook params, useXWagmiStore removed). Picks via Step 1. Links into the parent sodax-wallet-sdk-react knowledge tree. For the full multi-chain modal use the sibling wallet-modal skill; to feed the wallet into @sodax/sdk use the bridge-to-sdk skill.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Connect (`wallet-sdk-react` granular skill)

Granular skill for the everyday connect / disconnect + account-state + connector-discovery hooks of `@sodax/wallet-sdk-react` v2. React-only — backend wallets use `@sodax/wallet-sdk-core` directly. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?** New → § Integration. Port v1 → § Migration.
2. **Which task?** A connect/disconnect button (`useXConnect` / `useXDisconnect`), reading the account (`useXAccount` / `useXAccounts`), connection metadata (`useXConnection` / `useXConnections`), or listing wallets (`useXConnectors` / `useIsWalletInstalled`). Advanced: per-chain service access + `getXConnectorById` via `useXService` / `useXServices`.
3. **Single chain or per-family?** `useXAccount` takes **either** `xChainId` (chain key, narrowest typing) **or** `xChainType` (family) — never both.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../integration/knowledge/recipes/setup.md`](../integration/knowledge/recipes/setup.md) — prerequisite: mount `SodaxWalletProvider`, declare chain-type slots, wire React Query.
3. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — provider mount tree, frozen config, `xChainType` vs `xChainId`, persist hydration.
4. [`../integration/knowledge/recipes/connect-button.md`](../integration/knowledge/recipes/connect-button.md) and [`../integration/knowledge/recipes/chain-detection.md`](../integration/knowledge/recipes/chain-detection.md).
5. Lookups → [`../integration/knowledge/reference/hooks.md`](../integration/knowledge/reference/hooks.md) (incl. the service-level `useXService` / `useXServices`), [`connectors.md`](../integration/knowledge/reference/connectors.md), [`wallet-brands.md`](../integration/knowledge/reference/wallet-brands.md).

### Connect-specific anti-patterns

- **Passing both `xChainId` and `xChainType`** to `useXAccount` — mutually exclusive (throws).
- **Reading `useXConnect`'s resolved value for the account.** For provider-managed chains (EVM/Solana/Sui) it resolves `undefined` — read the account via `useXAccount` *after* the mutation lands.
- **Importing concrete connector classes from the barrel.** `EvmXService`, `XverseXConnector`, etc. are deep-import only (`@sodax/wallet-sdk-react/xchains/<chain>`) — see [`../integration/knowledge/recipes/sub-path-imports.md`](../integration/knowledge/recipes/sub-path-imports.md).
- **Calling hooks on a slot not in `walletConfig`.** Read-hooks degrade to empty (`useXConnectors` returns `[]` + a one-time warn). `useXConnect` *throws* (`Chain "<X>" is not enabled or ChainActions not registered`); `useXDisconnect` does not — it warns and resolves silently. Safe to call unconditionally, but branch on the return.

## Migration workflow (port v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — DO / DON'T (read first).
2. [`../migration-v1-to-v2/knowledge/breaking-changes.md`](../migration-v1-to-v2/knowledge/breaking-changes.md) — `useXWagmiStore` removed from the public API (replace each selector with a public hook); single-object hook params.
3. [`../migration-v1-to-v2/knowledge/recipes/connect-button.md`](../migration-v1-to-v2/knowledge/recipes/connect-button.md) — v1 positional-args button → v2.
4. Symbol lookups → [`../migration-v1-to-v2/knowledge/reference/imports.md`](../migration-v1-to-v2/knowledge/reference/imports.md) (store-hook field-to-hook map), [`hooks.md`](../migration-v1-to-v2/knowledge/reference/hooks.md).

## Verification

1. `pnpm tsc --noEmit` exits clean.
2. No `useXAccount` / `useWalletProvider` call passes both `xChainId` and `xChainType`.
3. `grep -rE 'useXWagmiStore|useXWalletStore' src/` is empty (migration only — v2 exports neither).
4. Account is read after connect lands, not from `useXConnect`'s resolved value.

## Related skills (same family)

- [`../wallet-modal/SKILL.md`](../wallet-modal/SKILL.md) — the full headless multi-chain modal + batch connect.
- [`../bridge-to-sdk/SKILL.md`](../bridge-to-sdk/SKILL.md) — feed the connected wallet into `@sodax/sdk` calls.
- [`../switch-chain/SKILL.md`](../switch-chain/SKILL.md) — EVM wrong-network handling.

For multi-feature work, load the broad [`sodax-wallet-sdk-react` skill](../SKILL.md).

## Wiring into dapp-kit (different package family)

The `xService` from `useXService` is what `@sodax/dapp-kit`'s balance hook (`useXBalances`) consumes, and the `useWalletProvider` result — see the [`bridge-to-sdk`](../bridge-to-sdk/SKILL.md) sibling skill — feeds dapp-kit's mutation hooks. For that consuming side and its exact param shapes, **also load the `sodax-dapp-kit` skill (integration mode)**.
