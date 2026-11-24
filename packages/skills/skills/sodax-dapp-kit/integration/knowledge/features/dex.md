# DEX — `@sodax/dapp-kit`

Concentrated-liquidity DEX (similar to Uniswap V3). Two-step flow: deposit assets to mint pool tokens, then supply liquidity to a position.

Pair: [`features/dex.md`](../../../migration-v1-to-v2/knowledge/features/dex.md).

## Hook surface

```ts
// @ai-snippets-skip
// Asset deposit / withdraw (spoke ↔ hub pool tokens)
useDexDeposit({ mutationOptions });
useDexWithdraw({ mutationOptions });
useDexAllowance({ params: { payload: CreateAssetDepositParams<K> }, queryOptions });
useDexApprove({ mutationOptions });
usePoolBalances({ params, queryOptions });

// Liquidity (pool tokens ↔ position)
useSupplyLiquidity({ mutationOptions });           // Mint new or increase existing
useDecreaseLiquidity({ mutationOptions });
useClaimRewards({ mutationOptions });

// Reads
usePools({ queryOptions });
usePoolData({ params, queryOptions });
usePositionInfo({ params, queryOptions });
useLiquidityAmounts({ params, queryOptions });

// Param builders (compute derived params client-side) — these take a FLAT props object,
// NOT a `{ params }` wrapper. They return memoized derived params that the consumer adds
// `srcChainKey` + `srcAddress` to at the mutation call site.
useCreateDepositParams({ tokenIndex, amount, poolData, poolSpokeAssets });        // no dst — deposits always target the hub
useCreateWithdrawParams({ tokenIndex, amount, poolData, poolSpokeAssets, dst? }); // dst? — withdraw routes hub → spoke
useCreateSupplyLiquidityParams({ poolData, poolKey, minPrice, maxPrice, liquidityToken0Amount, liquidityToken1Amount, slippageTolerance, positionId?, isValidPosition? });
useCreateDecreaseLiquidityParams({ /* see source for fields */ });
```

`use*Approve` is unchanged and still resolves to one transaction hash, but the SDK may send **two**
transactions on a token that rejects a non-zero to non-zero allowance change (Ethereum USDT today) —
the user signs twice and the hash is the **last** one's. An `isPending`-driven "Approving…" should say
so. See "Approve hooks can prompt the wallet twice" in [`architecture.md`](../architecture.md).

## SDK param types (passed via `mutate({ params, walletProvider })`)

Each dex mutation hook's TVars is `{ params: <SDKParamsType>, walletProvider, timeout? }`. The SDK param types below are what goes INSIDE `params` — they are not the TVars themselves.

```ts
// @ai-snippets-skip
// Deposit / withdraw — spoke chain assets → hub pool tokens (or vice versa)
type CreateAssetDepositParams<K> = {
  srcChainKey: K;
  srcAddress: GetAddressType<K>;
  asset: string;       // spoke-chain asset address
  amount: bigint;
  poolToken: string;   // hub-side pool token (vault) address
  dst?: { chainKey: SpokeChainKey; address: string };
};

// Supply liquidity — `useSupplyLiquidity` fans out internally to mint-new vs
// increase-existing based on params.tokenId + params.isValidPosition.
// The TVars `params` field is `UseCreateSupplyLiquidityParamsResult & { srcChainKey, srcAddress }`
// (the memoized output of `useCreateSupplyLiquidityParams` + the chain/address pair).
// Underlying SDK type ClSupplyParams<K> (for mint-new) has NO tokenId field:
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
// And ClIncreaseLiquidityParams<K> = ClSupplyParams<K> & { tokenId: bigint }
// for the increase-existing branch.

// Decrease liquidity
type ClDecreaseLiquidityParams<K> = {
  srcChainKey: K;
  srcAddress: GetAddressType<K>;
  poolKey: PoolKey;
  tokenId: bigint;
  liquidity: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
};

// Claim rewards
type ClClaimRewardsParams<K> = {
  srcChainKey: K;
  srcAddress: GetAddressType<K>;
  poolKey: PoolKey;
  tokenId: bigint;
  tickLower: bigint;
  tickUpper: bigint;
};
```

## Param builders

The `useCreate*Params` hooks compute the right derived params client-side (e.g. ERC-4626 share conversions for deposit, current tick range for liquidity). Spread the result into the mutation:

```ts
// @ai-snippets-skip — illustrative; `useCreateSupplyLiquidityParams` takes a FLAT props
// object (not `{ params }`-wrapped). The consumer adds `srcChainKey` + `srcAddress` at
// the mutation call site.
const supplyResult = useCreateSupplyLiquidityParams({
  poolData,
  poolKey,
  minPrice,
  maxPrice,
  liquidityToken0Amount,
  liquidityToken1Amount,
  slippageTolerance,
  positionId,         // optional, for increase-existing
  isValidPosition,    // optional, gates the increase-existing branch
});

const { mutateAsync: supply } = useSupplyLiquidity();
if (supplyResult && walletProvider) {
  await supply({
    params: { ...supplyResult, srcChainKey, srcAddress },
    walletProvider,
  });
}
```

## Return shapes

| Hook | Returns |
|---|---|
| `useDexDeposit` / `useDexWithdraw` | `SafeUseMutationResult<TxHashPair, Error, UseDexDepositVars<K>>` / `SafeUseMutationResult<OutboundSettlement<K>, Error, UseDexWithdrawVars<K>>` (TVars = `{ params, walletProvider, ...optional }`). `OutboundSettlement<K>` is `TxHashPair`, except from Tron: `{ trackingId, dstChainTxHash }`, since a withdraw-auth has no Tron tx |
| `useDexApprove` | `SafeUseMutationResult<TxReturnType<K, false>, Error, UseDexApproveVars<K>>` — chain-keyed receipt union |
| `useSupplyLiquidity` (mint or increase) | `SafeUseMutationResult<TxHashPair, Error, UseSupplyLiquidityVars<K>>` — single shape for both branches; fan-out happens inside the hook |
| `useDecreaseLiquidity` / `useClaimRewards` | `SafeUseMutationResult<TxHashPair, Error, ...>` |
| `useDexAllowance` | `UseQueryResult<boolean, Error>` (already unwrapped; throws on SDK `!ok`) |
| `usePools` | `UseQueryResult<PoolKey[], Error>` — `staleTime: Infinity` (no auto-refresh; pools are static config) |
| `usePoolData` | `UseQueryResult<PoolData, Error>` |
| `usePositionInfo` | `UseQueryResult<{ positionInfo: ClPositionInfo, isValid: boolean }, Error>` — `tokenId` param is `string \| null` (NOT bigint) |
| `usePoolBalances` | `UseQueryResult<{ token0Balance: bigint; token1Balance: bigint }, Error>` |
| `useLiquidityAmounts` | Direct synchronous calculation (memoized via `useMemo`) — not a React Query hook |

## Gotchas

1. **Two-step flow: deposit, then supply.** First `useDexDeposit` brings the spoke asset to the hub as pool-token shares (ERC-4626). Then `useSupplyLiquidity` uses those shares to mint or grow a position. UI flows usually combine them.
2. **`useSupplyLiquidity` handles both mint-new and increase-existing.** If `params.tokenId` is provided AND that position is valid for the pool, it increases. Otherwise it mints a new position. Use `useCreateSupplyLiquidityParams` to handle the routing.
3. **Ticks are logarithmic.** `tickLower` / `tickUpper` are not prices — they're indices. Convert with viem's `Q96` math or the SDK's helpers.
4. **`usePools` never auto-refreshes.** Pools are static config — fetch once. Override `queryOptions.refetchInterval` only if you really know your config changed.
5. **`useDexAllowance` doesn't take `walletProvider`.** Read-only — derives the user from `srcAddress` in `params`.
6. **`useClaimRewards` operates per-position.** If you need to claim across multiple positions, call it once per `tokenId`. The hook invalidates the corresponding `usePositionInfo` after success.

## Cross-references

- [`../recipes/dex.md`](../recipes/dex.md) — full worked examples.
- [`features/dex.md`](../../../migration-v1-to-v2/knowledge/features/dex.md) — v1 → v2 porting.
- `sodax-sdk`: `integration/knowledge/features/dex.md` — underlying SDK DEX surface.
