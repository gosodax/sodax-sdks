# Chain keys

The `ChainKey` type is the union of every `ChainKeys.*` value — the table below is the full set. **`SpokeChainKey` is the same union — it includes Sonic.** The "spoke" naming refers to how feature services type their `srcChainKey` parameter (they accept the hub too — bridge / swap / staking etc. all run from Sonic as source via the hub-wallet abstraction). When you specifically need "EVM chains excluding the hub" use `EVM_SPOKE_ONLY_CHAIN_KEYS` / `isEvmSpokeOnlyChainKeyType`.

| `ChainKeys.*` | String value | Family | Hub vs spoke | Address type |
|---|---|---|---|---|
| `SONIC_MAINNET` | `'sonic'` | EVM | **Hub** | `0x${string}` |
| `ETHEREUM_MAINNET` | `'ethereum'` | EVM | spoke | `0x${string}` |
| `ARBITRUM_MAINNET` | `'0xa4b1.arbitrum'` | EVM | spoke | `0x${string}` |
| `BASE_MAINNET` | `'0x2105.base'` | EVM | spoke | `0x${string}` |
| `BSC_MAINNET` | `'0x38.bsc'` | EVM | spoke | `0x${string}` |
| `OPTIMISM_MAINNET` | `'0xa.optimism'` | EVM | spoke | `0x${string}` |
| `POLYGON_MAINNET` | `'0x89.polygon'` | EVM | spoke | `0x${string}` |
| `AVALANCHE_MAINNET` | `'0xa86a.avax'` | EVM | spoke | `0x${string}` |
| `HYPEREVM_MAINNET` | `'hyper'` | EVM | spoke | `0x${string}` |
| `LIGHTLINK_MAINNET` | `'lightlink'` | EVM | spoke | `0x${string}` |
| `REDBELLY_MAINNET` | `'redbelly'` | EVM | spoke | `0x${string}` |
| `KAIA_MAINNET` | `'0x2019.kaia'` | EVM | spoke | `0x${string}` |
| `HEDERA_MAINNET` | `'hedera'` | EVM | spoke | `0x${string}` |
| `ROBINHOOD_MAINNET` | `'robinhood'` | EVM | spoke | `0x${string}` |
| `SOLANA_MAINNET` | `'solana'` | SOLANA | spoke | base58 PublicKey string |
| `SUI_MAINNET` | `'sui'` | SUI | spoke | `0x${string}` (32-byte) |
| `STELLAR_MAINNET` | `'stellar'` | STELLAR | spoke | `G…` |
| `ICON_MAINNET` | `'0x1.icon'` | ICON | spoke | `hx…` / `cx…` |
| `INJECTIVE_MAINNET` | `'injective-1'` | INJECTIVE | spoke | `inj1…` |
| `NEAR_MAINNET` | `'near'` | NEAR | spoke | `<account>.near` / `<hex>` |
| `STACKS_MAINNET` | `'stacks'` | STACKS | spoke | `SP…` / `ST…` |
| `BITCOIN_MAINNET` | `'bitcoin'` | BITCOIN | spoke | `bc1…` / `1…` / `3…` |

### Notes

- `ChainKeys.ICON_MAINNET` is the **string** `'0x1.icon'`, not the legacy numeric chain id. `Number(chainKey)` returns `NaN` for ICON.
- `SONIC_MAINNET` is special-cased — it's `'sonic'` (a simple string) and is the hub chain. `getChainType(ChainKeys.SONIC_MAINNET)` returns `'EVM'` (since Sonic is EVM-compatible) and `'SONIC'` is also a valid family in some contexts.
- Relay chain IDs (used internally for cross-chain coordination) are different from `ChainKey` strings. Convert via `sodax.config.getSpokeChainKeyFromIntentRelayChainId(BigInt(relayId))`.

### Type aliases

| Type | What it is |
|---|---|
| `ChainKey` | Union of all `ChainKeys.*` values. |
| `SpokeChainKey` | Same union as `ChainKey` — includes Sonic. For "EVM chains excluding the hub" use `EvmSpokeOnlyChainKey`. |
| `EvmChainKey` | Subset of `ChainKey` for the EVM chains. |
| `HubChainKey` | The literal `'sonic'`. |

### Chain-family helpers

```ts
import {
  getChainType,           // (chainKey) => 'EVM' | 'BITCOIN' | ...
  isEvmChainKeyType,
  isSolanaChainKeyType,
  isStellarChainKeyType,
  isSuiChainKeyType,
  isIconChainKeyType,
  isInjectiveChainKeyType,
  isStacksChainKeyType,
  isNearChainKeyType,
  isBitcoinChainKeyType,
  isHubChainKeyType,
} from '@sodax/sdk';
```

---

## Chain metadata (`baseChainInfo`)

`baseChainInfo` (exported from `@sodax/sdk`, re-exported from `@sodax/types`) maps every `ChainKey` to a static `BaseChainInfo` record:

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | Human-readable chain name. |
| `key` | `ChainKey` | The chain key (equals the map key). |
| `chainId` | `string \| number` | Native chain id — number for EVM, string for non-EVM. |
| `type` | `ChainType` | Chain family — same value as `getChainType(key)`. |
| `mainnet` | `boolean` | Whether the entry is a mainnet chain. |
| `logo` | `string` | Default chain logo URL (see below). |
| `explorer` | `{ baseUrl; txUrl; addressUrl; contractUrl }` | Block-explorer URL templates. |

```ts
import { baseChainInfo, ChainKeys } from '@sodax/sdk';

const { name, logo, explorer } = baseChainInfo[ChainKeys.BASE_MAINNET];
```

### Chain logos

Each entry's `logo` is a default logo URL — **read `baseChainInfo[key].logo` for chain icons; never hardcode icon paths.** The URL is built from the exported `CHAIN_LOGO_BASE_URL` as `${CHAIN_LOGO_BASE_URL}/${key}.png`:

```ts
import { baseChainInfo, CHAIN_LOGO_BASE_URL, ChainKeys } from '@sodax/sdk';

baseChainInfo[ChainKeys.SONIC_MAINNET].logo;
// → `${CHAIN_LOGO_BASE_URL}/sonic.png`
```

The PNGs are hosted in the repo's `@sodax/assets` package and served from `main` via `raw.githubusercontent.com` — so a newly added logo only resolves once merged to `main`. They are not bundled into the SDK.

---


## Cross-references

- [`README.md`](README.md) — reference index.
- [`../architecture.md`](../architecture.md) — concepts behind these tables.
