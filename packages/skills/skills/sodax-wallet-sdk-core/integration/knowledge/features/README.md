# Per-chain feature docs

One file per chain family. Each file documents:

- The provider class and the discriminated union of accepted configs.
- The `*Defaults` shape.
- The methods exposed on the provider (and how they merge defaults).
- Common gotchas specific to the chain.

| Chain family | Provider | Discriminant style | Underlying SDK |
|---|---|---|---|
| [EVM](./evm.md)           | `EvmWalletProvider`       | Field presence (no `type`) | `viem` |
| [Solana](./solana.md)     | `SolanaWalletProvider`    | Field presence | `@solana/web3.js` |
| [Sui](./sui.md)           | `SuiWalletProvider`       | Field presence (uses `mnemonics`) | `@mysten/sui` |
| [Bitcoin](./bitcoin.md)   | `BitcoinWalletProvider`   | Explicit `type` | `bitcoinjs-lib`, `ecpair`, `secp256k1` |
| [Stellar](./stellar.md)   | `StellarWalletProvider`   | Explicit `type` | `@stellar/stellar-sdk` |
| [ICON](./icon.md)         | `IconWalletProvider`      | Field presence | `icon-sdk-js` |
| [Injective](./injective.md)| `InjectiveWalletProvider` | Field presence (uses `secret` wrapper) | `@injectivelabs/sdk-ts`, `@injectivelabs/wallet-core` |
| [NEAR](./near.md)         | `NearWalletProvider`      | Field presence | `near-api-js` + `@hot-labs/near-connect` |
| [Stacks](./stacks.md)     | `StacksWalletProvider`    | Field presence | `@stacks/transactions`, `@stacks/connect` |

For the mental model behind these tables — why discriminants differ, how `defaults` merges, what `library-exports` re-exports — see [`../architecture.md`](../architecture.md).
