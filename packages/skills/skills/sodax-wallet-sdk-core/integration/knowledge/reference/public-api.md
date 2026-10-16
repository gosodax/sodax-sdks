# Public API surface

Every named export from `@sodax/wallet-sdk-core`. The package root is the **only** public surface — deep imports from `src/...` are unsupported.

```ts
// Single entry point
import { /* … */ } from '@sodax/wallet-sdk-core';
```

---

## Provider classes (9)

| Export | Chain family | File |
|---|---|---|
| `EvmWalletProvider` | EVM | `wallet-providers/evm/EvmWalletProvider.ts` |
| `SolanaWalletProvider` | Solana | `wallet-providers/solana/SolanaWalletProvider.ts` |
| `SuiWalletProvider` | Sui | `wallet-providers/sui/SuiWalletProvider.ts` |
| `BitcoinWalletProvider` | Bitcoin | `wallet-providers/bitcoin/BTCWalletProvider.ts` |
| `StellarWalletProvider` | Stellar | `wallet-providers/stellar/StellarWalletProvider.ts` |
| `IconWalletProvider` | ICON | `wallet-providers/icon/IconWalletProvider.ts` |
| `InjectiveWalletProvider` | Injective | `wallet-providers/injective/InjectiveWalletProvider.ts` |
| `NearWalletProvider` | NEAR | `wallet-providers/near/NearWalletProvider.ts` |
| `StacksWalletProvider` | Stacks | `wallet-providers/stacks/StacksWalletProvider.ts` |

Plus the abstract base:

| Export | Purpose |
|---|---|
| `BaseWalletProvider<TDefaults>` | Abstract base class. Exposes `getWalletAddress`, `mergePolicy`, `mergeDefaults`. **Subclass only for new chains.** |

---

## Config types (per chain)

Each chain ships **three** config-related exports:

| Pattern | Example | Purpose |
|---|---|---|
| `PrivateKey<Chain>WalletConfig` *or* `Secret<Chain>WalletConfig` (Injective) | `PrivateKeyEvmWalletConfig` | Private-key mode config |
| `BrowserExtension<Chain>WalletConfig` | `BrowserExtensionEvmWalletConfig` | Browser-extension mode config |
| `<Chain>WalletConfig` | `EvmWalletConfig` | Discriminated union — accept this in function signatures |
| `<Chain>WalletDefaults` | `EvmWalletDefaults` | Optional `defaults` slice |

Full list:

| Chain | Discriminated union | PK variant | Browser variant | Defaults |
|---|---|---|---|---|
| EVM       | `EvmWalletConfig`       | `PrivateKeyEvmWalletConfig`         | `BrowserExtensionEvmWalletConfig`       | `EvmWalletDefaults` |
| Solana    | `SolanaWalletConfig`    | `PrivateKeySolanaWalletConfig`      | `BrowserExtensionSolanaWalletConfig`    | `SolanaWalletDefaults` |
| Sui       | `SuiWalletConfig`       | `PrivateKeySuiWalletConfig`         | `BrowserExtensionSuiWalletConfig`       | `SuiWalletDefaults` |
| Bitcoin   | `BitcoinWalletConfig`   | `PrivateKeyBitcoinWalletConfig`     | `BrowserExtensionBitcoinWalletConfig`   | `BitcoinWalletDefaults` |
| Stellar   | `StellarWalletConfig`   | `PrivateKeyStellarWalletConfig`     | `BrowserExtensionStellarWalletConfig`   | `StellarWalletDefaults` |
| ICON      | `IconWalletConfig`      | `PrivateKeyIconWalletConfig`        | `BrowserExtensionIconWalletConfig`      | `IconWalletDefaults` |
| Injective | `InjectiveWalletConfig` | `SecretInjectiveWalletConfig` ⚠     | `BrowserExtensionInjectiveWalletConfig` | `InjectiveWalletDefaults` |
| NEAR      | `NearWalletConfig`      | `PrivateKeyNearWalletConfig`        | `BrowserExtensionNearWalletConfig`      | `NearWalletDefaults` |
| Stacks    | `StacksWalletConfig`    | `PrivateKeyStacksWalletConfig`      | `BrowserExtensionStacksWalletConfig`    | `StacksWalletDefaults` |

⚠ **Injective uses `Secret*`, not `PrivateKey*`** — see [`../features/injective.md`](../features/injective.md).

---

## Per-chain helpers and supporting types

| Export | Chain | Purpose |
|---|---|---|
| `getEvmViemChain(key: EvmChainKey)` | EVM | Maps a chain key to its viem `Chain` config. Exhaustive — adding a new key fails typecheck until handled. |
| `hyper` (viem `Chain`) | EVM | Locally-defined HyperEVM chain config (not in `viem/chains`). |
| `isPrivateKeyEvmWalletConfig` | EVM | Predicate for narrowing `EvmWalletConfig`. |
| `isBrowserExtensionEvmWalletConfig` | EVM | Predicate for narrowing `EvmWalletConfig`. |
| `EvmSendTransactionPolicy` | EVM | Per-call options shape for `sendTransaction`. |
| `EvmWaitForTransactionReceiptPolicy` | EVM | Per-call options shape for `waitForTransactionReceipt`. |
| `WalletContextState` | Solana | Subset of `@solana/wallet-adapter-react` context — used by browser-extension config. |
| `SuiSignAndExecutePolicy` | Sui | Per-call options for `signAndExecuteTxn`. |
| `SuiGetCoinsPolicy` | Sui | Per-call options for `getCoins`. |
| `BitcoinNetwork` | Bitcoin | `'TESTNET' \| 'MAINNET'` |
| `BitcoinWalletsKit` (interface) | Bitcoin | Adapter contract for browser-extension mode. |
| `BitcoinPkWallet` / `BitcoinBrowserWallet` / `BitcoinWallet` | Bitcoin | Internal runtime-wallet union (exported for type assertions in tests). |
| `StellarNetwork` | Stellar | `'TESTNET' \| 'PUBLIC'` |
| `StellarAddress` | Stellar | `string` brand. |
| `StellarWalletsKit` (interface) | Stellar | Adapter contract for browser-extension mode. |
| `StellarPkWallet` / `StellarBrowserExtensionWallet` / `StellarWallet` | Stellar | Internal runtime-wallet union (exported for tests). |
| `IconJsonRpcVersion` / `Hex` / `Hash` / `IconAddress` / `IconEoaAddress` | ICON | Address & hex brands. |
| `IconPkWallet` / `IconBrowserExtensionWallet` / `IconWallet` | ICON | Internal runtime-wallet union. |
| `HanaWalletRequestEvent` / `HanaWalletResponseEvent` | ICON | Event names for the Hana wallet `postMessage` bridge. |
| `ResponseAddressType` / `ResponseSigningType` / `RelayRequestDetail` / `RelayRequestSigning` / `JsonRpcPayloadResponse` | ICON | Hana wallet message shapes. |
| `InjectiveWallet` | Injective | Internal runtime-wallet shape. |
| `NearTxExecutionStatus` | NEAR | `'NONE' \| 'INCLUDED' \| 'EXECUTED_OPTIMISTIC' \| 'INCLUDED_FINAL' \| 'EXECUTED' \| 'FINAL'` |
| `StacksPkWallet` / `StacksBrowserExtensionWallet` / `StacksWallet` | Stacks | Internal runtime-wallet union. |

---

## `library-exports` (types + a few runtime values)

Re-exports from upstream chain SDKs. See [`../recipes/library-exports.md`](../recipes/library-exports.md) for the full table and intended usage.

Type-only (selected examples):

```ts
import type {
  WalletClient, PublicClient, TransactionReceipt,   // from viem
  Commitment, ConnectionConfig, SendOptions,         // from @solana/web3.js
  Network, ChainId, EvmChainId, MsgBroadcaster,      // from @injectivelabs/*
  ClarityValue, PostConditionModeName,               // from @stacks/transactions
  StacksNetwork, StacksProvider,                     // from @stacks/network, @stacks/connect
  KeyPairString, NearConnector,                      // from near-api-js, @hot-labs/near-connect
  BitcoinJsNetwork,                                  // from bitcoinjs-lib
} from '@sodax/wallet-sdk-core';
```

Runtime values:

```ts
import { Networks, PostConditionMode } from '@sodax/wallet-sdk-core';
```

---

## NOT exported (intentional)

| Symbol | Where it lives | Why hidden |
|---|---|---|
| `shallowMerge` | `src/utils/merge.ts` | Internal merge helper — semantics may change. |
| Anything under `src/utils/` | — | All internal. |
| `EvmWalletProvider.serializeReceipt` | private static method | Implementation detail of `waitForTransactionReceipt`. |

If you need one of these, the corresponding **behavior** is exposed via a method — call that instead.
