# DEX — `DexService` (`AssetService` + `ClService`)

Concentrated liquidity AMM, similar to Uniswap V3 / PancakeSwap V3. Two sub-services:

- **`AssetService`** — wraps/unwraps spoke assets into the hub-side pool tokens. `deposit` (spoke→hub), `withdraw` (hub→spoke).
- **`ClService`** — full concentrated-liquidity position lifecycle: mint, increase, decrease, claim rewards. Pool / position read methods. (Class lives in `ConcentratedLiquidityService.ts` but the exported class is named `ClService`.)

Access: `sodax.dex.assetService`, `sodax.dex.clService`. Class names: `AssetService`, `ClService`. Feature tag for errors: `'dex'`.

## How it works

To enter a position:

1. **`assetService.deposit({ asset, amount, poolToken, ... })`** — wraps the spoke token into the hub-side pool token (vault).
2. **`assetService.approve(...)`** — permit the CL contract to spend the wrapped token.
3. **`clService.supplyLiquidity({ poolKey, ..., liquidity, amount0Max, amount1Max })`** — mints a new position NFT.

To increase / decrease / claim:

- **`clService.increaseLiquidity({ tokenId, ... })`** — adds liquidity to an existing position.
- **`clService.decreaseLiquidity({ tokenId, liquidity, amount0Min, amount1Min })`** — removes a fraction of liquidity (no NFT burn).
- **`clService.claimRewards({ tokenId, poolKey, tickLower, tickUpper })`** — collects accrued fees/rewards for a position.

## Public methods

```ts
// AssetService
sodax.dex.assetService.deposit<K>(action: AssetDepositAction<K, false>): Promise<Result<TxHashPair, SodaxError>>;
sodax.dex.assetService.withdraw<K>(action: AssetWithdrawAction<K, false>): Promise<Result<OutboundSettlement<K>, SodaxError>>;
sodax.dex.assetService.approve<K, Raw>(args): Promise<Result<TxReturnType<K, Raw>, SodaxError>>;
sodax.dex.assetService.isAllowanceValid<K, Raw>(args): Promise<Result<boolean, SodaxError>>;
sodax.dex.assetService.getDeposit(poolToken, walletAddress, chainKey): Promise<Result<bigint, SodaxError>>;
sodax.dex.assetService.executeDeposit<K, Raw>(args): /* spoke-only deposit; no relay */;

// ClService (concentrated liquidity) — refuses a Tron source
sodax.dex.clService.supplyLiquidity<K>(action): Promise<Result<TxHashPair, SodaxError>>;
sodax.dex.clService.increaseLiquidity<K>(action): Promise<Result<TxHashPair, SodaxError>>;
sodax.dex.clService.decreaseLiquidity<K>(action): Promise<Result<TxHashPair, SodaxError>>;
sodax.dex.clService.claimRewards<K>(action): Promise<Result<TxHashPair, SodaxError>>;

sodax.dex.clService.getPools(): PoolKey[];                 // synchronous in v2
sodax.dex.clService.getPoolData(poolKey, publicClient): Promise<Result<PoolData, SodaxError>>;
sodax.dex.clService.getPositionInfo(tokenId, publicClient): Promise<Result<ClPositionInfo, SodaxError>>;
sodax.dex.clService.getAssetsForPool(srcChainKey, poolKey): { token0, token1 };   // chain-key-first; sync

// Static math helpers (still throw on error — utility class):
ClService.priceToTick(price, token0, token1, tickSpacing): bigint;
ClService.calculateAmount0FromAmount1(...): bigint;
ClService.calculateAmount1FromAmount0(...): bigint;
```

## Action params shape

```ts
type CreateAssetDepositParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: GetAddressType<K>;
  asset: `0x${string}`;       // spoke-side token address
  amount: bigint;
  poolToken: `0x${string}`;   // hub-side pool token (vault address)
  dst?: { dstChainKey: SpokeChainKey; dstAddress: string };  // optional cross-chain delivery
};

type CreateAssetWithdrawParams<K> = { /* same shape */ };

type ClSupplyParams<K> = {
  srcChainKey: K;
  srcAddress: GetAddressType<K>;
  poolKey: PoolKey;
  tickLower: bigint;
  tickUpper: bigint;
  liquidity: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  sqrtPriceX96: bigint;
};

type ClIncreaseLiquidityParams<K> = ClSupplyParams<K> & { tokenId: bigint };
type ClDecreaseLiquidityParams<K> = {
  srcChainKey: K;
  srcAddress: GetAddressType<K>;
  poolKey: PoolKey;
  tokenId: bigint;
  liquidity: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
};
type ClClaimRewardsParams<K> = { srcChainKey, srcAddress, poolKey, tokenId, tickLower, tickUpper };
```

## Common call shapes

### Deposit (spoke asset → hub pool token)

```ts
const result = await sodax.dex.assetService.deposit({
  params: {
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    srcAddress: '0x…',
    asset: USDC.address,
    amount: parseUnits('100', 6),
    poolToken: '0x…',  // the hub-side pool token (XToken.vault)
  },
  raw: false,
  walletProvider: evmWp,
});

if (!result.ok) return;
const { srcChainTxHash, dstChainTxHash } = result.value;
```

### Mint a new concentrated-liquidity position

```ts
const result = await sodax.dex.clService.supplyLiquidity({
  params: {
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    srcAddress: '0x…',
    poolKey: { /* { currency0, currency1, fee, tickSpacing, hooks } */ },
    tickLower: -887220n,
    tickUpper: 887220n,
    liquidity: 1000000n,
    amount0Max: parseUnits('100', 6),
    amount1Max: parseUnits('100', 6),
    sqrtPriceX96: /* current sqrtPrice */,
  },
  raw: false,
  walletProvider: evmWp,
});
```

### Increase liquidity on an existing position

```ts
await sodax.dex.clService.increaseLiquidity({
  params: { /* same as supplyLiquidity, plus tokenId: existingPositionTokenId */ },
  raw: false,
  walletProvider: evmWp,
});
```

### Allowance check (read-only)

```ts
const allowed = await sodax.dex.assetService.isAllowanceValid({
  params: { srcChainKey, srcAddress, asset, amount, poolToken },
  raw: true,    // read-only — no walletProvider required
});
```

The underlying read does not consult the wallet provider; pass `raw: true` to satisfy `WalletProviderSlot` without supplying a provider.

## Return shapes

| Method | Success type |
|---|---|
| `deposit`, `supplyLiquidity`, `increaseLiquidity`, `decreaseLiquidity`, `claimRewards` | `TxHashPair` |
| `withdraw` | `OutboundSettlement<K>`: `TxHashPair`, or from Tron `{ trackingId, dstChainTxHash }` |
| `approve` | `TxReturnType<K, Raw>` |
| `isAllowanceValid` | `boolean` |
| `getDeposit` | `bigint` (user's balance in the pool's hub wallet) |
| `getPoolData` | `{ liquidity, sqrtPriceX96, tick, /* … */ }` |
| `getPositionInfo` | `{ poolKey, tickLower, tickUpper, liquidity, fees0, fees1, /* … */ }` |
| `getPools` | `PoolKey[]` (synchronous, returns from cached config) |
| `getAssetsForPool` | `{ token0: XToken, token1: XToken }` (synchronous; takes `srcChainKey` to filter by spoke availability) |

> `getPools()` is **synchronous** in v2 (was `Promise<PoolKey[]>` in v1). v2 reads from cached config — no I/O. `await sodax.dex.clService.getPools()` works (TS allows `await` on non-promise) but `.then(...)` is a runtime error.

`approve` can send **two** transactions on a token that rejects a non-zero to non-zero allowance
change (Ethereum USDT is the only listed one today): `approve(0)` is mined first, then the real
approval, so the user signs twice. The returned value is unchanged — one hash, the **last**
transaction's. Detection simulates the approval, so never gate on a token list. Full note: "ERC-20
approval can take two transactions" in [`architecture.md`](../architecture.md).

## Error codes

`feature: 'dex'`. Per-method narrow unions:

| Method | Codes | Action |
|---|---|---|
| `deposit`, `withdraw`, `supplyLiquidity`, `increaseLiquidity`, `decreaseLiquidity`, `claimRewards` | full exec set | matches operation |
| `approve` | `VALIDATION_FAILED`, `APPROVE_FAILED`, `UNKNOWN` | matches operation |
| `isAllowanceValid` | `VALIDATION_FAILED`, `ALLOWANCE_CHECK_FAILED`, `UNKNOWN` | n/a |
| `getDeposit`, `getPoolData`, `getPositionInfo` | `VALIDATION_FAILED`, `LOOKUP_FAILED`, `UNKNOWN` | (use `error.context.method`) |

## Cross-references

- v1 → v2 DEX migration: [`features/dex.md`](../../../migration-v1-to-v2/knowledge/features/dex.md).
- The hub-side `EvmHubProvider.publicClient` is what `getPoolData` / `getPositionInfo` use internally — consumers can pass `sodax.hubProvider.publicClient`.
