# Type-system breaking changes — v1 → v2

Every type-level rename and shape change introduced by v2. Fix these first — once your imports compile, every other migration step is tractable. The errors you'll see during this phase live in three buckets: **import resolution** (a symbol moved or was deleted), **field access** (a field renamed), and **shape mismatch** (a generic added a required parameter, a return type changed).

> v1 source the comparisons below cite: `github.com/icon-project/sodax-frontend` (branch `sdk-v1-main`), `packages/sdk` and `packages/types`. v2 source: this package's `src/`.

## Section index

1. [Chain identifiers](#1-chain-identifiers) — `*_MAINNET_CHAIN_ID` → `ChainKeys.*`. The single biggest mechanical migration.
2. [`@sodax/types` package surface](#2-sodaxtypes-package-surface) — what to import, what got renamed, what got deleted.
3. [Wallet-provider typing](#3-wallet-provider-typing) — `GetWalletProviderType<K>` and `WalletProviderSlot<K, Raw>` replace ad-hoc spoke-provider classes.
4. [`Token` / `XToken` field renames](#4-token--xtoken-field-renames) — `xChainId` → `chainKey`; `Token` → `XToken`.
5. [`RpcConfig` reshape](#5-rpcconfig-reshape) — now keyed by `ChainKey` values; chain-family-specific shapes for Bitcoin and Stellar.
6. [`IConfigApiV1` Result-wrapping](#6-iconfigapiv1-result-wrapping) — every method returns `Promise<Result<T>>`.
7. [Address-type rename](#7-address-type-rename) — `AddressType` → `BtcAddressType`.
8. [Wallet-provider `chainType` discriminant](#8-wallet-provider-chaintype-discriminant) — every `I*WalletProvider` declares a literal field.
9. [`ChainId` / `SpokeChainId` → `SpokeChainKey`](#9-chainid--spokechainid--spokechainkey) — type alias rename.
10. [Deleted module-error types](#10-deleted-module-error-types) — covered structurally here, semantics in [`result-and-errors.md`](result-and-errors.md).

---

## 1. Chain identifiers

v1 exported one constant per chain (`SONIC_MAINNET_CHAIN_ID`, `ARBITRUM_MAINNET_CHAIN_ID`, …). v2 collapses them into a single `ChainKeys` object whose values are the same string union exposed as the `ChainKey` type. The constants and their old union (`SpokeChainId` / `ChainId`) are deleted.

### Import migration

```diff
- import {
-   SONIC_MAINNET_CHAIN_ID,
-   ARBITRUM_MAINNET_CHAIN_ID,
-   AVALANCHE_MAINNET_CHAIN_ID,
-   // ...
- } from '@sodax/types';
+ import { ChainKeys } from '@sodax/sdk'; // re-exported from @sodax/types
```

> Prefer importing `ChainKeys` from `@sodax/sdk` — see [§2](#2-sodaxtypes-package-surface). Importing from `@sodax/types` still works but adds an unnecessary peer dependency.

### Full mapping table

| v1 constant | v2 `ChainKeys.*` | String value |
|---|---|---|
| `SONIC_MAINNET_CHAIN_ID` | `ChainKeys.SONIC_MAINNET` | `'sonic'` |
| `ARBITRUM_MAINNET_CHAIN_ID` | `ChainKeys.ARBITRUM_MAINNET` | `'0xa4b1.arbitrum'` |
| `AVALANCHE_MAINNET_CHAIN_ID` | `ChainKeys.AVALANCHE_MAINNET` | `'0xa86a.avax'` |
| `BASE_MAINNET_CHAIN_ID` | `ChainKeys.BASE_MAINNET` | `'0x2105.base'` |
| `BSC_MAINNET_CHAIN_ID` | `ChainKeys.BSC_MAINNET` | `'0x38.bsc'` |
| `ETHEREUM_MAINNET_CHAIN_ID` | `ChainKeys.ETHEREUM_MAINNET` | `'ethereum'` |
| `HEDERA_MAINNET_CHAIN_ID` | `ChainKeys.HEDERA_MAINNET` | `'hedera'` |
| `HYPEREVM_MAINNET_CHAIN_ID` | `ChainKeys.HYPEREVM_MAINNET` | `'hyper'` |
| `ICON_MAINNET_CHAIN_ID` | `ChainKeys.ICON_MAINNET` | `'0x1.icon'` |
| `INJECTIVE_MAINNET_CHAIN_ID` | `ChainKeys.INJECTIVE_MAINNET` | `'injective-1'` |
| `KAIA_MAINNET_CHAIN_ID` | `ChainKeys.KAIA_MAINNET` | `'0x2019.kaia'` |
| `LIGHTLINK_MAINNET_CHAIN_ID` | `ChainKeys.LIGHTLINK_MAINNET` | `'lightlink'` |
| `NEAR_MAINNET_CHAIN_ID` | `ChainKeys.NEAR_MAINNET` | `'near'` |
| `OPTIMISM_MAINNET_CHAIN_ID` | `ChainKeys.OPTIMISM_MAINNET` | `'0xa.optimism'` |
| `POLYGON_MAINNET_CHAIN_ID` | `ChainKeys.POLYGON_MAINNET` | `'0x89.polygon'` |
| `REDBELLY_MAINNET_CHAIN_ID` | `ChainKeys.REDBELLY_MAINNET` | `'redbelly'` |
| `SOLANA_MAINNET_CHAIN_ID` | `ChainKeys.SOLANA_MAINNET` | `'solana'` |
| `STACKS_MAINNET_CHAIN_ID` | `ChainKeys.STACKS_MAINNET` | `'stacks'` |
| `STELLAR_MAINNET_CHAIN_ID` | `ChainKeys.STELLAR_MAINNET` | `'stellar'` |
| `SUI_MAINNET_CHAIN_ID` | `ChainKeys.SUI_MAINNET` | `'sui'` |
| `BITCOIN_MAINNET_CHAIN_ID` | `ChainKeys.BITCOIN_MAINNET` | `'bitcoin'` |

### Bulk codemod

```bash
# Find — preserves capture group
grep -rE '(\w+)_MAINNET_CHAIN_ID' src/

# Sed (one-shot)
find src -type f -name '*.ts' -o -name '*.tsx' | xargs sed -i '' -E 's/([A-Z_]+)_MAINNET_CHAIN_ID/ChainKeys.\1_MAINNET/g'
```

After replacement, fix import statements: remove the individual constants, add `ChainKeys`. See [`../recipes.md`](../recipes.md) § "Codemod patterns" for a more robust `ts-morph` variant.

### Pitfalls

1. **`ChainKeys.ICON_MAINNET` is a string `'0x1.icon'`, not the legacy numeric ID.** Anywhere v1 did `Number(chainId)` for ICON, the v2 result is `NaN`. Use string equality (`chainKey === ChainKeys.ICON_MAINNET`) and audit numeric coercions.
2. **`SONIC_MAINNET` is `'sonic'`, not `'0x92.sonic'`** — it's the simple string `'sonic'` because Sonic is the hub chain and treated specially by routing.
3. **Don't confuse `ChainKey` with relay chain IDs.** Read shapes like `Intent.srcChain` and `Intent.dstChain` are still `IntentRelayChainId` (bigint) — those did **not** rename. A blanket `srcChain` → `srcChainKey` grep-replace will break Intent reads. Use `sodax.config.getSpokeChainKeyFromIntentRelayChainId(...)` to convert.

---

## 2. `@sodax/types` package surface

### Export reorganization

v1 had a single `packages/types/src/constants/index.ts` barrel exporting all chain IDs and ad-hoc tables. That file is **deleted**. Symbols now live in domain-organized modules: `chains/`, `swap/`, `wallet/`, `bitcoin/`, etc.

| v1 import path | v2 home |
|---|---|
| `@sodax/types/btc/...` | `@sodax/types/bitcoin` (path renamed) |
| `*_MAINNET_CHAIN_ID` from `@sodax/types` constants index | `ChainKeys.*` (single barrel) |
| `Token` | `XToken` (renamed; see [§4](#4-token--xtoken-field-renames)) |
| `SpokeChainId` / `ChainId` | `SpokeChainKey` (see [§9](#9-chainid--spokechainid--spokechainkey)) |

### Re-export from `@sodax/sdk`

`@sodax/sdk` v2 barrel re-exports the entire `@sodax/types` surface (`export * from '@sodax/types'` from `src/index.ts`). For consumers, this means:

- **Recommended:** import everything from `@sodax/sdk`. You don't need a separate `@sodax/types` dependency.
- **Tolerated:** keep importing from `@sodax/types` directly. v2 guarantees type identity (since SDK bundles `@sodax/types` via `noExternal`), but you'll pin two versions instead of one.

### Pitfall

If your `package.json` lists `@sodax/types` as a direct dependency in v2, **remove it**. Letting it float independent of `@sodax/sdk` invites silent version skew on the next minor bump.

---

## 3. Wallet-provider typing

v1 modeled "the wallet to use for chain X" as a class instance: `EvmSpokeProvider`, `SolanaSpokeProvider`, etc. Consumers constructed one and passed it positionally to every SDK call. v2 deletes these classes (see [`architecture.md`](architecture.md) § "Spoke-provider deletion") and replaces the typing with two parameterised aliases:

```ts
GetChainType<K extends ChainKey>            // 'EVM' | 'BITCOIN' | 'SOLANA' | …
GetWalletProviderType<K extends ChainKey>   // IEvmWalletProvider | IBitcoinWalletProvider | …
```

When the caller passes a literal chain key (e.g. `ChainKeys.ETHEREUM_MAINNET`), TypeScript preserves the literal in the generic `K`. From that one literal:

- `GetChainType<K>` resolves to `'EVM'`.
- `GetWalletProviderType<K>` resolves to `IEvmWalletProvider` (the exact interface, not a broad union).

This is what allows v2 to demand the chain-correct wallet provider at compile time without a runtime check.

### `WalletProviderSlot<K, Raw>` — the discriminator

```ts
// Conceptual; lives in @sodax/types/common
export type WalletProviderSlot<K extends ChainKey, Raw extends boolean> =
  Raw extends true
    ? { raw: true; walletProvider?: never }
    : { raw: false; walletProvider: GetWalletProviderType<K> };
```

Three rules enforced at compile time:

1. **`raw: true`** — `walletProvider` is **forbidden** (`?: never` rejects any value). The method returns a raw, unsigned tx payload. Use for sign-elsewhere flows.
2. **`raw: false`** — `walletProvider` is **required** and chain-narrowed. The method signs and broadcasts; returns a tx hash.
3. **No overlap** — TypeScript can't pick a branch unless the discriminator field is present. Forgetting `raw: false` is the #1 v2 typecheck error after migration.

### Migration mechanics

```diff
  await sodax.swaps.createIntent({
-   intentParams,
-   spokeProvider: sourceProvider,
+   params: intentParams,
+   raw: false,
+   walletProvider: sourceWalletProvider,
  });
```

For raw-tx building:

```diff
- // v1 had a separate executeXxx method per chain
- const tx = await sourceProvider.executeCreateIntent(intentParams);
+ const result = await sodax.swaps.createIntent({ params: intentParams, raw: true });
+ // result.value: { tx: EvmRawTransaction | SolanaRawTransaction | ..., intent, relayData }
```

### Pitfall

If your wallet provider variable is typed as the broad `IWalletProvider | undefined` union (the typical case when the variable is keyed by a runtime chain-key value rather than a literal), v2 still accepts it — `K` defaults to the broad `SpokeChainKey` union, so `GetWalletProviderType<K>` resolves to the `IWalletProvider` union. For tighter narrowing on a literal chain branch, see [`../recipes.md`](../recipes.md) § "Cast-at-boundary".

---

## 4. `Token` / `XToken` field renames

| v1 | v2 |
|---|---|
| `Token` (type name) | `XToken` |
| `Token.xChainId` | `XToken.chainKey` |
| `Token.symbol`, `decimals`, `address`, `name` | unchanged |
| (n/a) | `XToken.vault` — added; the hub-side ERC4626 vault for this token |
| (n/a) | `XToken.hubAsset` — added; the hub-side wrapped/unified asset address |

Migration:

```diff
- import type { Token } from '@sodax/types';
+ import type { XToken } from '@sodax/sdk';
- token.xChainId
+ token.chainKey
```

### Why `vault` / `hubAsset` matter

v1 consumers reached into a global `hubAssets[chainId][address]` map to get the vault address for a token. **v2 deletes that global** and bakes the data directly into every supported `XToken`. Anywhere v1 walked `hubAssets`, v2 reads `token.vault` or `token.hubAsset` directly. See [`architecture.md`](architecture.md) § "ConfigService replaces static lookups" for the full lookup migration.

### Pitfall

Read shapes like `Intent` and `IntentResponse` from the backend keep `srcChain` / `dstChain` as the **relay** chain id (numeric, `IntentRelayChainId`). They are **not** chain keys and were **not** renamed to `srcChainKey`/`dstChainKey`. Only **request** types (`CreateIntentParams`, `CreateLimitOrderParams`, `SubmitTxRequestV2`) gained the `*ChainKey` field names.

### Exception — partner module read shapes DID rename

The above "read shapes keep `srcChain`/`dstChain`" rule has one exception: **partner module** read shapes also renamed `dstChain` → `dstChainKey`. Specifically:

- `AutoSwapPreferences` (returned by `sodax.partners.getAutoSwapPreferences(queryAddress)`) — field `dstChain` → **`dstChainKey: SpokeChainKey | 'not configured'`**.
- `SetSwapPreferenceParams` (request type for `setSwapPreference`) — `dstChain` → `dstChainKey: SpokeChainKey`.

```diff
- // v1
- const prefs = await partnerFeeClaimService.getAutoSwapPreferences(addr);
- const destChain: SpokeChainId = prefs.dstChain;

+ // v2
+ const result = await sodax.partners.getAutoSwapPreferences(addr);
+ if (!result.ok) return;
+ const destChain: SpokeChainKey | 'not configured' = result.value.dstChainKey;
```

A blanket grep `dstChain` → `dstChainKey` is safe in the partner module **but** still unsafe in `Intent` / `IntentResponse` reads. Scope grep replacements per file or per import. The general rule for `srcChain` (Intent read field) is unchanged: it remains the relay chain id.

---

## 5. `RpcConfig` reshape

v1 modeled `RpcConfig` as a flat object with one optional URL field per chain. v2 makes it a mapped type keyed by `ChainKey` values, with chain-family-specific shapes:

```ts
type RpcConfig = {
  [K in ChainKey]:
    K extends typeof ChainKeys.BITCOIN_MAINNET ? BitcoinRpcConfig :
    K extends typeof ChainKeys.STELLAR_MAINNET ? StellarRpcConfig :
    string  // RPC URL for every other chain
};
```

Migration:

```diff
- rpcConfig.sonic
+ rpcConfig[ChainKeys.SONIC_MAINNET]
- rpcConfig.btc
+ rpcConfig[ChainKeys.BITCOIN_MAINNET]   // BitcoinRpcConfig (shape, not string)
```

### Pitfall

Bitcoin and Stellar have richer RPC needs than other chains (multiple endpoints, network params). Their entries in `RpcConfig` are objects, not strings. If your config builder did `rpcConfig.btc = 'https://…'` in v1, that's a type error in v2 — you need the full `BitcoinRpcConfig` shape.

---

## 6. `IConfigApiV1` Result-wrapping

Every method on the `IConfigApiV1` contract changed signature in v2. v1 returned plain `Promise<T>` and threw on failure; v2 returns `Promise<Result<T>>` and never throws.

| Method | v1 return | v2 return |
|---|---|---|
| `getChains` | `Promise<ChainConfig[]>` | `Promise<Result<GetChainsApiResponse>>` |
| `getSwapTokens` | `Promise<SwapTokenConfig>` | `Promise<Result<GetSwapTokensApiResponse>>` |
| `getSwapTokensByChainId` | `Promise<XToken[]>` | `Promise<Result<XToken[]>>` |
| `getMoneyMarketTokens` | `Promise<MMTokenConfig>` | `Promise<Result<GetMoneyMarketTokensApiResponse>>` |
| `getMoneyMarketTokensByChainId` | `Promise<XToken[]>` | `Promise<Result<XToken[]>>` |
| `getRelayChainIdMap` | (n/a in v1) | `Promise<Result<GetRelayChainIdMapApiResponse>>` (v2-new) |

If you implemented a custom `IConfigApiV1` (e.g. for a sandbox or test fixture), update every method signature. If you only consumed the default implementation through `Sodax.config`, the SDK already uses `Result` internally — your consumer-side code doesn't see the wrapping.

---

## 7. Address-type rename

The Bitcoin-specific address-type union changed name to free up the generic `AddressType` identifier:

```diff
- import type { AddressType } from '@sodax/types';
+ import type { BtcAddressType } from '@sodax/sdk';
```

Value union is unchanged: `'P2PKH' | 'P2SH' | 'P2WPKH' | 'P2TR'`. Custom Bitcoin wallet provider implementations must update the import.

---

## 8. Wallet-provider `chainType` discriminant

Every `I*WalletProvider` interface in v2 declares a `readonly chainType: '<CHAIN>'` literal field. Custom implementations must add the field; consumers can use it for runtime narrowing without `instanceof`:

```ts
if (walletProvider.chainType === 'EVM') {
  // walletProvider: IEvmWalletProvider
}
if (walletProvider.chainType === 'SOLANA') {
  // walletProvider: ISolanaWalletProvider
}
```

Supported values: the `ChainType` union (`'EVM'`, `'BITCOIN'`, …; full set in `ChainTypeArr`).

This replaces v1's `provider instanceof EvmSpokeProvider` discrimination. Cross-bundle `instanceof` is fragile (different `@sodax/sdk` copies in dual ESM/CJS bundles can return false); the literal `chainType` field works regardless.

---

## 9. `ChainId` / `SpokeChainId` → `SpokeChainKey`

Type alias rename. Same value union (the chain-key strings).

```diff
- import type { ChainId, SpokeChainId } from '@sodax/types';
+ import type { SpokeChainKey } from '@sodax/sdk';
- function pickChain(id: ChainId): boolean { ... }
+ function pickChain(key: SpokeChainKey): boolean { ... }
```

Function bodies that compared `chainId === SONIC_MAINNET_CHAIN_ID` need [§1](#1-chain-identifiers)'s constant rename in addition to the type rename.

---

## 10. Deleted module-error types

These types were exported from v1 but are deleted in v2. Replace with `SodaxError<C>` (see [`result-and-errors.md`](result-and-errors.md) for full semantics):

- `MoneyMarketError<MoneyMarketErrorCode>`
- `IntentError<IntentErrorCode>`
- `StakingError<StakingErrorCode>`
- `BridgeError<BridgeErrorCode>`
- `MigrationError<MigrationErrorCode>`
- `AssetServiceError<AssetServiceErrorCode>`
- `ConcentratedLiquidityError<ConcentratedLiquidityErrorCode>`
- `RelayError<RelayErrorCode>`
- 5 partner error types (`PartnerFeeClaimError<...>`, etc.) and their `is<Module>Error()` type-guard helpers.

The replacement contract:

```diff
- if (error instanceof MoneyMarketError && error.code === 'CREATE_SUPPLY_INTENT_FAILED') { … }
+ if (isSodaxError(error) && error.feature === 'moneyMarket' && error.code === 'INTENT_CREATION_FAILED') { … }
```

The full v1 → v2 code crosswalk lives in [`result-and-errors.md`](result-and-errors.md) § "v1 ↔ v2 code crosswalk".

---

## Cross-references

- Architectural changes (spoke-provider deletion, ConfigService, relay flow): [`architecture.md`](architecture.md).
- Result/error model details (propagation patterns, code crosswalk, return shapes): [`result-and-errors.md`](result-and-errors.md).
- v2 design context (what to use instead of each deleted symbol): [`architecture.md`](../../../integration/knowledge/architecture.md).
- Lookup tables (full chain-key list, `I*WalletProvider` interfaces, public API surface): [`reference/`](../../../integration/knowledge/reference/).
