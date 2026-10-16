# Added fields and types

Additive changes that older code does not use. All optional — no migration required.

---

## New types

| Type | Chain(s) | Purpose |
|---|---|---|
| `EvmWalletDefaults` | EVM | `defaults` slice shape |
| `EvmSendTransactionPolicy` | EVM | Per-call options shape for `sendTransaction` |
| `EvmWaitForTransactionReceiptPolicy` | EVM | Per-call options shape for `waitForTransactionReceipt` |
| `SolanaWalletDefaults` | Solana | `defaults` slice shape |
| `SuiWalletDefaults` | Sui | `defaults` slice shape |
| `SuiSignAndExecutePolicy` | Sui | Per-call options for `signAndExecuteTxn` |
| `SuiGetCoinsPolicy` | Sui | Per-call options for `getCoins` |
| `BitcoinWalletDefaults` | Bitcoin | `defaults` slice shape |
| `StellarWalletDefaults` | Stellar | `defaults` slice shape |
| `IconWalletDefaults` | ICON | `defaults` slice shape |
| `InjectiveWalletDefaults` | Injective | `defaults` slice shape |
| `NearWalletDefaults` | NEAR | `defaults` slice shape |
| `NearTxExecutionStatus` | NEAR | Status union for `waitUntil` default |
| `StacksWalletDefaults` | Stacks | `defaults` slice shape |
| `BaseWalletProvider<TDefaults>` | all | Abstract base class (consumers do not subclass) |

---

## New optional fields on existing configs

| Config | Field | Default if omitted |
|---|---|---|
| `PrivateKeyEvmWalletConfig` | `defaults?: EvmWalletDefaults` | `{}` |
| `BrowserExtensionEvmWalletConfig` | `defaults?: EvmWalletDefaults` | `{}` (note: transport/clients in defaults are no-ops here) |
| `PrivateKeySolanaWalletConfig` | `defaults?: SolanaWalletDefaults` | `{}` |
| `BrowserExtensionSolanaWalletConfig` | `defaults?: SolanaWalletDefaults` | `{}` |
| `PrivateKeySuiWalletConfig` | `defaults?: SuiWalletDefaults` | `{}` |
| `BrowserExtensionSuiWalletConfig` | `defaults?: SuiWalletDefaults` | `{}` |
| `PrivateKeyBitcoinWalletConfig` | `defaults?: BitcoinWalletDefaults` | `{}` |
| `BrowserExtensionBitcoinWalletConfig` | `defaults?: BitcoinWalletDefaults` | `{}` |
| `PrivateKeyStellarWalletConfig` | `defaults?: StellarWalletDefaults` | `{}` |
| `BrowserExtensionStellarWalletConfig` | `defaults?: StellarWalletDefaults` | `{}` |
| `PrivateKeyIconWalletConfig` | `defaults?: IconWalletDefaults` | `{}` |
| `BrowserExtensionIconWalletConfig` | `defaults?: IconWalletDefaults` | `{}` |
| `SecretInjectiveWalletConfig` | `defaults?: InjectiveWalletDefaults` | `{}` |
| `BrowserExtensionInjectiveWalletConfig` | `defaults?: InjectiveWalletDefaults` | `{}` |
| `PrivateKeyNearWalletConfig` | `defaults?: NearWalletDefaults` | `{}` |
| `BrowserExtensionNearWalletConfig` | `defaults?: NearWalletDefaults` | `{}` |
| `PrivateKeyStacksWalletConfig` | `defaults?: StacksWalletDefaults` | `{}` |
| `BrowserExtensionStacksWalletConfig` | `defaults?: StacksWalletDefaults` | `{}` |

---

## New library-exports re-exports

See [`recipes/library-exports.md`](../../../integration/knowledge/recipes/library-exports.md) for the full table. Re-exporting these means consumers can drop direct deps on upstream chain SDKs for type-only usage.

Summary:

- **viem** — `Account`, `Address`, `Chain`, `Transport`, `PublicClient`, `WalletClient`, `HttpTransportConfig`, `PublicClientConfig`, `WalletClientConfig`, `SendTransactionParameters`, `WaitForTransactionReceiptParameters`, `TransactionReceipt`
- **@mysten/sui** — `Transaction`, `TransactionArgument`
- **@solana/web3.js** — `Commitment`, `ConnectionConfig`, `SendOptions`
- **@injectivelabs/*** — `Network`, `ChainId`, `EvmChainId`, `MsgBroadcaster`
- **@stellar/stellar-sdk** — `Networks` (runtime value)
- **@stacks/transactions** — `PostConditionMode` (runtime enum), `ClarityValue`, `PostConditionModeName`
- **@stacks/network** — `StacksNetwork`
- **@stacks/connect** — `StacksProvider`
- **near-api-js** — `KeyPairString`
- **@hot-labs/near-connect** — `NearConnector`
- **bitcoinjs-lib** — `Network as BitcoinJsNetwork`
