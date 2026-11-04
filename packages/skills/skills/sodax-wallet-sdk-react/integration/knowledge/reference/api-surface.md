# Reference: API Surface

The complete public export surface of `@sodax/wallet-sdk-react` v2. This is the **single source of truth** for "what can I import". If a symbol is not listed here, it is not part of the public API.

The `check:ai-imports` guard in `@sodax/skills` validates that every `import … from '@sodax/wallet-sdk-react'` statement in this knowledge tree (including sub-path imports) typechecks against the live `src/`. Symbol drift in prose (e.g. mentioning a hook that doesn't exist) is caught by reviewers — keep this file aligned with `packages/wallet-sdk-react/src/index.ts` exports.

---

## Barrel exports — `import { X } from '@sodax/wallet-sdk-react'`

### Components

| Symbol | Kind | Source |
|---|---|---|
| `SodaxWalletProvider` | React component | `SodaxWalletProvider.tsx` |
| `SodaxWalletProviderProps` | type | `SodaxWalletProvider.tsx` |
| `WalletConfigProvider` | React component (advanced — internal context) | `context/WalletConfigContext` |

### Hooks

See [`hooks.md`](./hooks.md) for full signatures. Names only:

- `useXAccount`, `useXAccounts`
- `useXConnect`, `useXDisconnect`
- `useXConnection`, `useXConnections`
- `useXConnectors`, `useXConnectorsByChain`
- `useIsWalletInstalled`
- `useChainGroups`, `useConnectedChains`
- `useConnectionFlow`
- `useBatchConnect`, `useBatchDisconnect`
- `useWalletModal`
- `useWalletProvider`
- `useXService`, `useXServices`
- `useEnabledChains`
- `useEvmSwitchChain`
- `useXSignMessage`

### Abstract classes (advanced — extend only when implementing a new chain)

| Symbol | Kind | Source |
|---|---|---|
| `XService` | abstract class | `core/XService` |
| `XConnector` | abstract class | `core/XConnector` |

### Imperative actions

| Symbol | Kind | Source |
|---|---|---|
| `getXChainType` | function | `actions/getXChainType` |
| `getXService` | function | `actions/getXService` |

### Utilities

| Symbol | Notes |
|---|---|
| `sortConnectors` | Stable-sort connectors by `preferred[]` then install state. See [`connectors.md`](./connectors.md). |
| `getEntryDefaults`, `getRpcUrl`, `resolveEvmDefaults` | Read defaults / RPC URL out of `SodaxWalletConfig` (advanced — for custom Hydrator-like code). |
| `isNativeToken`, `getWagmiChainId` | Small helpers — native-token check and `ChainKey` → wagmi numeric chain id. |

### Public interfaces

| Symbol | Kind | Source |
|---|---|---|
| `IXService` | interface | `types/interfaces` |
| `IXConnector` | interface | `types/interfaces` |
| `IWalletProvider` | re-export from `@sodax/types` | `types/index` |

### Account / connection types

| Symbol | Kind |
|---|---|
| `XAccount` | type |
| `XConnection` | type |

### Config types

Top-level:

| Symbol | Kind |
|---|---|
| `SodaxWalletConfig` | type |
| `ChainTypeConfig<T>` | generic type |
| `ChainEntry<K>` | generic type |
| `ChainMeta` | type |
| `ChainTypeOf<K>` | generic type |
| `WalletDefaultsByKey<K>` | generic type |

Per-chain aliases follow two naming patterns — one alias per chain family (9 each):

- `<Chain>TypeConfig` — per-slot config (e.g. `EvmTypeConfig`, `SolanaTypeConfig`)
- `<Chain>ChainEntry` — per-chain-key entry (e.g. `EvmChainEntry`, `BitcoinChainEntry`)

Replace `<Chain>` with `Evm | Solana | Sui | Bitcoin | Stellar | Injective | Icon | Near | Stacks`. Most consumers can derive these from `ChainTypeConfig<T>` / `ChainEntry<K>` instead of importing the per-chain alias directly.

Adapter-field types (only chains with React adapters):

| Symbol | Kind |
|---|---|
| `EvmAdapterFields` | type |
| `SolanaAdapterFields` | type |
| `SuiAdapterFields` | type |

### Hook option / result types

Every hook also exports its options / result types alongside it. Naming pattern is `Use<Name>Options`, `Use<Name>Result` (or `Use<Name>Return`), and any inline value types in `PascalCase` (e.g. `ChainGroup`, `ConnectedChain`, `WalletModalState`, `ConnectionStatus`). See [`hooks.md`](./hooks.md) for the signature each pair belongs to.

---

## Sub-path exports — `import { X } from '@sodax/wallet-sdk-react/xchains/<chain>'`

Concrete chain classes live behind sub-paths. Default to barrel imports; opt into these only when you need `instanceof`, want to extend a class, or are wiring a custom connector list via `ChainTypeConfig.connectors`.

### Default pattern (most chains)

`/xchains/{bitcoin, evm, icon, injective, near, solana, stacks, stellar, sui}` re-export the chain's `XService` + `XConnector` classes — `EvmXService`/`EvmXConnector`, `SolanaXService`/`SolanaXConnector`, `BitcoinXService`/`BitcoinXConnector`, `StacksXService`/`StacksXConnector`, `StellarXService`/`StellarWalletsKitXConnector`, etc. Icon also exports `IconHanaXConnector` (the connector for the Hana wallet).

```ts
// @ai-snippets-skip
import { EvmXService, EvmXConnector } from '@sodax/wallet-sdk-react/xchains/evm';
import { IconHanaXConnector } from '@sodax/wallet-sdk-react/xchains/icon';
```

### Chains with extra exports

| Sub-path | Beyond `XService`/`XConnector` |
|---|---|
| `/xchains/bitcoin` | `XverseXConnector`, `UnisatXConnector`, `OKXXConnector`, `BitcoinHanaXConnector` (4 wallet connectors), hook `useBitcoinXConnectors`, type `BtcWalletAddressType` |
| `/xchains/evm` | `createWagmiConfig` (function — also exported as alias `createWagmi`); `tryCookieToInitialState` (wraps wagmi's `cookieToInitialState` so a malformed SSR cookie yields `undefined` instead of throwing) |
| `/xchains/icon` | `CHAIN_INFO` (value), `SupportedChainId` (enum) |
| `/xchains/stacks` | `STACKS_PROVIDERS` (value), hook `useStacksXConnectors`, type `StacksProviderConfig` |

### Special case

| Sub-path | Notes |
|---|---|
| `/xchains/stellar` | Re-exports `StellarXService` + `StellarWalletsKitXConnector` (the concrete connector wrapping `@creit.tech/stellar-wallets-kit`). |

If unsure what a sub-path exports, check the published `dist/`:

```bash
grep -E '^export' node_modules/@sodax/wallet-sdk-react/dist/xchains/<chain>/index.d.ts
```

---

## Peer dependencies (consumer must install)

| Package | Version |
|---|---|
| `react` | `>= 19` |
| `@tanstack/react-query` | `5.x` |

`@tanstack/react-query` is required at runtime — `<QueryClientProvider>` must wrap `<SodaxWalletProvider>`. v1 mounted one internally; v2 does not.

---

## Not exported (deliberately internal)

These exist in the source but are **not** part of the public API. Do not import from `@sodax/wallet-sdk-react/dist/...` to reach them.

- `useEthereumChainId` — read EVM chain id via wagmi's `useAccount().chainId` instead.
- `useInitChainServices` — used by `<SodaxWalletProvider>` only.
- `useXWalletStore` — Zustand store hook. Public hooks are the supported surface; if you need store access, file an issue describing the use case.

---

## What the v2 barrel does NOT re-export (vs v1)

For migration context only — these were on v1's barrel:

- All concrete `XService` / `XConnector` classes (now sub-path imports)
- `useXBalances` (moved to `@sodax/dapp-kit` with a new signature — see `migration/breaking-changes.md` § 10)
- `XWagmiProviders` (renamed to `SodaxWalletProvider`)
- `useXWagmiStore` (the store hook — v2 doesn't export the store hook under any name; use public hooks like `useXServices` / `useXConnections` instead)

See [`reference/imports.md`](../../../migration-v1-to-v2/knowledge/reference/imports.md) for the full v1→v2 import map.
