# Chain support

Chain families and spoke chain keys this package can sign for. Keys live in `@sodax/types`.

---

## EVM (one provider, 14 chains)

`EvmWalletProvider` covers every EVM spoke chain via `getEvmViemChain()`. The provider is exhaustive — adding a new `EvmChainKey` to `@sodax/types` requires updating `getEvmViemChain` (caught at compile time via a `never` assertion in the default branch).

| Spoke chain key | viem chain |
|---|---|
| `ChainKeys.SONIC_MAINNET` (hub) | `sonic` |
| `ChainKeys.ETHEREUM_MAINNET` | `mainnet` |
| `ChainKeys.ARBITRUM_MAINNET` | `arbitrum` |
| `ChainKeys.BASE_MAINNET` | `base` |
| `ChainKeys.BSC_MAINNET` | `bsc` |
| `ChainKeys.OPTIMISM_MAINNET` | `optimism` |
| `ChainKeys.POLYGON_MAINNET` | `polygon` |
| `ChainKeys.AVALANCHE_MAINNET` | `avalanche` |
| `ChainKeys.HYPEREVM_MAINNET` | `hyper` (defined inside this package) |
| `ChainKeys.LIGHTLINK_MAINNET` | `lightlinkPhoenix` |
| `ChainKeys.REDBELLY_MAINNET` | `redbellyMainnet` |
| `ChainKeys.KAIA_MAINNET` | `kaia` |
| `ChainKeys.HEDERA_MAINNET` | `hedera` |
| `ChainKeys.ROBINHOOD_MAINNET` | `robinhoodChain` (defined locally — absent from `viem/chains`) |

---

## Non-EVM (one provider per chain family)

| Chain family | Provider | Spoke chain key(s) |
|---|---|---|
| Solana    | `SolanaWalletProvider`    | `ChainKeys.SOLANA_MAINNET` |
| Sui       | `SuiWalletProvider`       | `ChainKeys.SUI_MAINNET` |
| Bitcoin   | `BitcoinWalletProvider`   | `ChainKeys.BITCOIN_MAINNET` |
| Stellar   | `StellarWalletProvider`   | `ChainKeys.STELLAR_MAINNET` |
| ICON      | `IconWalletProvider`      | `ChainKeys.ICON_MAINNET` |
| Injective | `InjectiveWalletProvider` | `ChainKeys.INJECTIVE_MAINNET` |
| NEAR      | `NearWalletProvider`      | `ChainKeys.NEAR_MAINNET` |
| Stacks    | `StacksWalletProvider`    | `ChainKeys.STACKS_MAINNET` |

> 22 spoke chains total = 14 EVM + 8 non-EVM. The hub chain (Sonic) is counted with EVM.

---

## Upstream chain-SDK matrix

Run-time deps each provider pulls in. See [`../recipes/library-exports.md`](../recipes/library-exports.md) for how to re-import their **types** without a direct dep.

| Provider | Upstream SDKs |
|---|---|
| `EvmWalletProvider`       | `viem` |
| `SolanaWalletProvider`    | `@solana/web3.js`, `@solana/spl-token`, `@solana/wallet-adapter-base` |
| `SuiWalletProvider`       | `@mysten/sui` |
| `BitcoinWalletProvider`   | `bitcoinjs-lib`, `ecpair`, `secp256k1`, `@bitcoinerlab/secp256k1`, `bip322-js` |
| `StellarWalletProvider`   | `@stellar/stellar-sdk` |
| `IconWalletProvider`      | `icon-sdk-js` |
| `InjectiveWalletProvider` | `@injectivelabs/sdk-ts`, `@injectivelabs/wallet-core`, `@injectivelabs/networks`, `@injectivelabs/ts-types` |
| `NearWalletProvider`      | `near-api-js`, `@hot-labs/near-connect` |
| `StacksWalletProvider`    | `@stacks/transactions`, `@stacks/connect`, `@stacks/network` |

---

## When to NOT use this package

If your chain is not in the table above, this package does not yet support it. Adding a new chain is a **maintainer task** — open an issue if your chain is missing.
