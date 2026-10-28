# Wallet provider interfaces

Every chain family has an `I*WalletProvider` interface. Each declares a `readonly chainType: '<NAME>'` literal field for runtime discrimination.

| Family | Interface | `chainType` literal | Implementation |
|---|---|---|---|
| EVM | `IEvmWalletProvider` | `'EVM'` | `EvmWalletProvider` (private-key or browser-extension) |
| Solana | `ISolanaWalletProvider` | `'SOLANA'` | `SolanaWalletProvider` |
| Sui | `ISuiWalletProvider` | `'SUI'` | `SuiWalletProvider` |
| Stellar | `IStellarWalletProvider` | `'STELLAR'` | `StellarWalletProvider` |
| ICON | `IIconWalletProvider` | `'ICON'` | `IconWalletProvider` (uses Hana-extension helper functions for browser; see `../chain-specifics.md` § 4) |
| Injective | `IInjectiveWalletProvider` | `'INJECTIVE'` | `InjectiveWalletProvider` |
| Stacks | `IStacksWalletProvider` | `'STACKS'` | `StacksWalletProvider` |
| NEAR | `INearWalletProvider` | `'NEAR'` | `NearWalletProvider` |
| Bitcoin | `IBitcoinWalletProvider` | `'BITCOIN'` | `BitcoinWalletProvider` (PSBT) |
| Tron | `ITronWalletProvider` | `'TRON'` | `TronWalletProvider` |

### Common methods

Every `I*WalletProvider` has:

```ts
getWalletAddress(): Promise<string>;
// Returns the chain-specific address (typed as `0x${string}` for EVM, base58 for Solana, etc.).
readonly chainType: '<FAMILY>';
```

Plus chain-specific signing/broadcasting methods. Each interface declares the methods consumers must implement to satisfy it; consumers usually don't call these methods directly — they pass the provider object to SDK methods. **Implementations are not part of `@sodax/sdk`** — write your own to satisfy the interface, or use `@sodax/wallet-sdk-core` (a separate SODAX package, install separately) which ships ready-made implementations for every chain family with both private-key (Node) and browser-extension (dApp) modes.

### `GetWalletProviderType<K>`

Given a chain key literal `K`, resolves to the exact wallet provider interface for that chain:

```ts
GetWalletProviderType<typeof ChainKeys.ETHEREUM_MAINNET>  // IEvmWalletProvider
GetWalletProviderType<typeof ChainKeys.SOLANA_MAINNET>    // ISolanaWalletProvider
GetWalletProviderType<typeof ChainKeys.BITCOIN_MAINNET>   // IBitcoinWalletProvider
GetWalletProviderType<SpokeChainKey>                      // IWalletProvider (broad union)
```

### `IWalletProvider` (broad union)

The discriminated union of every `I*WalletProvider` interface. Useful when a function accepts any chain's wallet provider:

```ts
import type { IWalletProvider } from '@sodax/sdk';

function logChain(wp: IWalletProvider) {
  console.log(wp.chainType);
}
```

### Implementing the interfaces

Each `I*WalletProvider` interface defines the methods consumers must implement; credentials, RPC clients, and browser-extension wiring are implementation concerns and intentionally outside the SDK. The SODAX-provided reference implementations in `@sodax/wallet-sdk-core` (separate package) accept either `{ privateKey, rpcUrl }` for Node / scripts or chain-specific browser-extension shapes (`{ walletClient }` for EVM via viem, `{ adapter }` for Solana, etc.) — refer to that package's documentation for specifics.

---


## Cross-references

- [`README.md`](README.md) — reference index.
- [`../architecture.md`](../architecture.md) — concepts behind these tables.
