# Reference: Chain Support

Chains supported by `@sodax/wallet-sdk-react` v2 — their `ChainType` family and per-slot config shape. Use this when picking which slots to include in `walletConfig`.

---

## Chain families (`ChainType`)

9 chain families. Each is a top-level slot on `SodaxWalletConfig`:

| ChainType | Networks (examples) | React adapter mounted |
|---|---|---|
| `EVM` | Sonic, Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia, Hedera, Robinhood Chain | wagmi |
| `SOLANA` | Solana mainnet | `@solana/wallet-adapter-react` |
| `SUI` | Sui mainnet/testnet | `@mysten/dapp-kit-react` |
| `BITCOIN` | Bitcoin mainnet | (none — direct extension probes) |
| `STELLAR` | Stellar mainnet | (none) |
| `ICON` | ICON mainnet | (none) |
| `INJECTIVE` | Injective mainnet | (none) |
| `NEAR` | NEAR mainnet | (none) |
| `STACKS` | Stacks mainnet | (none) |

EVM is the only family with multiple networks under one connection — wagmi maintains a single connection that spans every configured EVM network. See [`../architecture.md`](../architecture.md) § "EVM is one connection".

---

## Per-slot config shape

| Slot | Config fields | Notes |
|---|---|---|
| `EVM` | `ssr?, reconnectOnMount?, initialState?, walletConnect?, connectors?, chains` | `chains` keyed by `ChainKey` → `{ rpcUrl?, defaults? }` |
| `SOLANA` | `autoConnect?, connectors?, chains` | `chains` keyed by `ChainKey` → `{ rpcUrl?, defaults? }` |
| `SUI` | `network?, connectors?, chains?` | `network: 'mainnet' \| 'testnet'` |
| `BITCOIN` | extends `BitcoinRpcConfig` + `{ defaults?, connectors? }` | Pass `{}` for SDK defaults |
| `STELLAR` | extends `StellarRpcConfig` + `{ defaults?, connectors? }` | Pass `{}` for SDK defaults |
| `INJECTIVE` | extends `InjectiveRpcConfig` + `{ defaults?, connectors? }` | Pass `{}` for SDK defaults |
| `ICON` | `connectors?, chains` | `chains` keyed by `ChainKey` → `{ rpcUrl?, defaults? }` |
| `NEAR` | `connectors?, chains` | `chains` keyed by `ChainKey` → `{ rpcUrl?, defaults? }` |
| `STACKS` | preset name (string) **or** `StacksNetworkLike & { defaults?, connectors? }` | `'mainnet'` / `'testnet'` preset accepted |

The single source of truth for the per-chain shape is `ChainMeta` in `src/types/config.ts` — `SodaxWalletConfig`, `ChainEntry<K>`, `WalletDefaultsByKey<K>` derive from it.

---

## ChainKey constants

`ChainKey` is the chain-id enum exported from `@sodax/types`. Use it in `walletConfig.<SLOT>.chains[<ChainKey>]` and in hooks that take `xChainId`.

```ts
import { ChainKeys } from '@sodax/types';

ChainKeys.SONIC_MAINNET;       // EVM
ChainKeys.ETHEREUM_MAINNET;    // EVM
ChainKeys.SOLANA_MAINNET;      // SOLANA
ChainKeys.BITCOIN_MAINNET;     // BITCOIN
// …etc
```

Naming pattern: `<NETWORK>_MAINNET`. EVM has 14 entries (Sonic, Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia, Hedera, Robinhood Chain); the other 8 families each have one. Inspect `@sodax/types` for the authoritative list.

---

## Slot opt-in behavior

- **Omit a slot** to skip mounting that adapter entirely. The chain won't appear in `useXConnectors`, `useChainGroups`, or `useEnabledChains`.
- **Pass `{}`** to mount with SDK defaults. Useful for chains where you don't need to override RPC or connectors.
- **Provide a partial config** (`{ chains: {...} }`) to override only what you need; everything else uses defaults.

```ts
// @ai-snippets-skip
const walletConfig: SodaxWalletConfig = {
  EVM: { ssr: true, chains: { [ChainKeys.SONIC_MAINNET]: { rpcUrl: '...' } } }, // explicit
  BITCOIN: {},                                                                    // defaults
  SOLANA: { autoConnect: false, chains: { [ChainKeys.SOLANA_MAINNET]: {} } },     // partial
  // STELLAR not included → not mounted
};
```

For per-hook fallback behavior when a slot is omitted, see [`hooks.md`](./hooks.md) § "Behavior when the chain slot is not in walletConfig".
