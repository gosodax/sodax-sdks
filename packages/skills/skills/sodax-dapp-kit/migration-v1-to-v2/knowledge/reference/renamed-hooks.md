# Renamed hooks — v1 → v2

Hooks whose **name** changed between versions. Most v1 → v2 changes were signature-level (single-object params, `mutateAsyncSafe`, etc.) — actual hook renames are rare. The list below is the small set.

## Hooks renamed

| v1 | v2 | Notes |
|---|---|---|
| (none significant) | | Most hook names are stable across v1 → v2 |

### Why this list is short

The v2 canonicalization pass focused on hook **shapes** (single-object params, return-shape consolidation, mutateAsyncSafe), not naming. For most consumer code, the hook name you `import { ... }`'d in v1 is still the right hook in v2 — the breaking change is in the call shape, not the import.

## Hooks whose generic / type shape changed

These keep their name but their TypeScript signature is different. Usually requires per-call-site fixes.

| Hook | v1 → v2 change |
|---|---|
| `useSwap` | Hook init: `(spokeProvider) → ({ mutationOptions })`. Vars: `{ params } → { params, walletProvider }`. |
| `useSwapAllowance` | Query params: `(params, spokeProvider) → { params: { payload, srcChainKey, walletProvider } }`. SDK request nested under `params.payload`. Data unwrapped to `boolean`. |
| `useSwapApprove` | Return: `{ approve, isLoading } → SafeUseMutationResult` (with `mutateAsync` / `isPending`). Vars accept `CreateIntentParams \| CreateLimitOrderParams`. TData is `TxReturnType<K, false>` (chain-keyed receipt union). |
| `useStatus` | Now `useStatus({ params: { intentTxHash } })` — single-object shape AND key renamed from `intentHash` → `intentTxHash`. Data is `Result<SolverIntentStatusResponse, SolverErrorResponse> \| undefined` (Result-wrapped). Polls 3s; stops on `3`/`4` and after 40 consecutive NOT_FOUND fetches. |
| `useQuote` | Now `useQuote({ params: { payload } })` — SDK request nested under `params.payload` (NOT directly under `params`). Data is `Result<SolverIntentQuoteResponse, SolverErrorResponse> \| undefined`. Polls 3s. |
| `useCancelSwap` / `useCancelLimitOrder` | TVars are FLAT (no `params` wrapper): `{ srcChainKey, intent, walletProvider }`. |
| `useCreateLimitOrder` | Hook init: `(spokeProvider) → ({ mutationOptions })`. Vars: `{ params, walletProvider }`. mutationKey is `['swap', 'limitOrder', 'create']`. |
| All MM mutations (`useSupply`/etc.) | Same as `useSwap`. Plus `srcChainKey` / `srcAddress` required in params (SDK-leakage). All four actions accept optional `dstChainKey`/`dstAddress` for cross-chain delivery (not just borrow/repay). |
| `useMMAllowance` | Query params: `{ params: { payload: MoneyMarketParams<K> } }`. For `'borrow'` / `'withdraw'` actions: `enabled: false` — `data` stays `undefined`. |
| `useUserReservesData` | Param key rename: `address → userAddress`; chain key is `spokeChainKey`. |
| `useUserFormattedSummary` | Same. |
| `useATokensBalances` | Params: `{ aTokens, spokeProvider, userAddress } → { params: { aTokens, spokeChainKey, userAddress } }`. `spokeProvider` dropped; chain key is **`spokeChainKey`** (NOT `srcChainKey`); user field is **`userAddress`** (NOT `address`). Data: `Map<Address, bigint> \| undefined` (already unwrapped). |
| `useAToken` | Unaffected by the position-hook renames — takes only `{ aToken }`. Data: `Erc20Token & { chainKey }` (`hubAsset` / `vault` NOT included). |
| All staking mutations | Same as MM. Plus dedicated approve hooks per token (`useStakeApprove` ↔ `useUnstakeApprove` ↔ `useInstantUnstakeApprove`). |
| `useStakeRatio` | Return: `Result<bigint> → [xSodaAmount, previewDepositAmount]` (unwrapped tuple — NOT Result-wrapped in v2). |
| `useStakingInfo` / `useUnstakingInfo` / `useUnstakingInfoWithPenalty` / `useStakingConfig` / `useInstantUnstakeRatio` / `useConvertedAssets` | All unwrapped in v2 (hooks throw on SDK `!ok`). Branch on `isError`/`error`, not `data?.ok`. |
| `useUnstakingInfo` | Return shape: array → object `{ userUnstakeSodaRequests, totalUnstaking }`. `UserUnstakeInfo` items expose `id` (the requestId) and `request` (original `UnstakeSodaRequest`). |
| All three staking allowance hooks | Query params: `{ params: { payload: Omit<<Action>Params<K>, 'action'> } }`. Data unwrapped to `boolean`. |
| `useBridge` | Params: `srcChainId/dstChainId/recipient → srcChainKey/dstChainKey/recipient`. Plus field renames inside `CreateBridgeIntentParams`: `srcAsset → srcToken`, `dstAsset → dstToken`. Return: tuple → `TxHashPair` object (`{ srcChainTxHash, dstChainTxHash }`). |
| `useBridgeAllowance` | Query params: nested `{ params: { payload, walletProvider } }`. Data unwrapped to `boolean` (queryFn returns `false` on SDK `!ok` — does NOT throw). |
| `useGetBridgeableAmount` | Params: 4 fields → `{ from: XToken, to: XToken }`. Return: `bigint → BridgeLimit` object (`{ amount, decimals, type: 'DEPOSIT_LIMIT' \| 'WITHDRAWAL_LIMIT' }`). |
| `useGetBridgeableTokens` | Params: positional → `{ params: { from, to, token } }`. |
| All DEX mutations | Same as MM. `useSupplyLiquidity` now handles both mint-new and increase-existing — fan-out gated by `params.tokenId` + `params.isValidPosition`. |
| `useDexAllowance` | Now `{ params: { payload: CreateAssetDepositParams<K> } }`. No `walletProvider` (read-only). |
| `PoolKey` shape | Real fields are `currency0`, `currency1`, `fee`, `hooks?`, `poolManager`, `parameters` — NOT `poolAddress`/`token0Symbol`/etc. |
| `useCreate*Params` builders | All take FLAT props object — NOT `{ params }`-wrapped (`useCreateDepositParams`, `useCreateWithdrawParams`, `useCreateSupplyLiquidityParams`, `useCreateDecreaseLiquidityParams`). |
| `useFeeClaimSwap` (partner) | Same as MM mutation pattern. TData is `IntentAutoSwapResult` (NOT `SwapResponse`). |
| `useXBalances` | Params: positional → `{ params: { xService, xChainId, xTokens, address } }`. All four required. `xService` injected from `@sodax/wallet-sdk-react`. |
| `useEstimateGas` | Mutation; vars: `EstimateGasParams<C>` (flat, not `{ params, walletProvider }`-wrapped). |
| `useDeriveUserWalletAddress`, `useGetUserHubWalletAddress` | Single-object query shape. |
| `useStellarTrustlineCheck` | Single-object shape under `params`: `{ token, amount, chainId, walletAddress }`. Pass the resolved Stellar address (e.g. `useXAccount('STELLAR').address`), not a wallet provider — it keys the cache per account. |
| `useRequestTrustline` → `useEstablishTrustline` | Canonical mutation hook: `{ mutationOptions }` in, `SafeUseMutationResult` out, vars `{ token, amount, srcChainKey, walletProvider }`. `useRequestTrustline` remains as a deprecated wrapper with its 2.0.0 shape — positional `(token: string \| undefined)` (ignored) and `{ requestTrustline, isLoading, isRequested, error, data }` — and is removed in the next major. |
| `useBackendOrderbook` / `useBackendAllMoneyMarketBorrowers` | Pagination MUST be nested under `params`: `{ params: { pagination: { offset, limit } } }`. |
| `useBackendUserIntents` | Data is `UserIntentsResponse = { items: IntentResponse[], total, offset, limit }` — NOT a bare array. Access `data?.items`. |
| `useSwapsApiSubmitTx` / `useSwapsApiSubmitTxStatus` (v1: `useBackendSubmitSwapTx` / `useBackendSubmitSwapTxStatus`) | Renamed + moved to the `swapsApi/` namespace (keys now `['swapsApi', …]`). Mutation `apiConfig` moved from hook init to `mutate(vars)`; the status query now requires `srcChainKey`. The rest of the Swaps API is newly wrapped as `useSwapsApi*` hooks. |
| All migration hooks | **NEW**: 6 per-action hooks replacing v1's single `useMigrate`. See [`deleted-hooks.md`](deleted-hooks.md). |
| `useMigrationAllowance` | Query params nest under `params` with inner field literally named `params` (NOT `payload`): `{ params: { params: <migration-params>, action: 'migrate' \| 'revert' } }`. |
| `BalnMigrateParams` (used by `useMigrateBaln`) | NEW required field `stake: boolean`. `lockupPeriod` is the `LockupPeriod` enum (5 members; values in seconds, not months). |
| `useTradingWalletBalance` | Return is `RadfiWalletBalance = { btcSatoshi, pendingSatoshi, externalPendingSatoshi, totalUtxos }` — NOT `{ confirmed, pending }`. |
| `useExpiredUtxos` | Return is `RadfiUtxo[]` (with `_id`, `txid`, `vout`, `txidVout`, `satoshi`, `amount`, `address`, `isSpent`, `status`, `source`, optional `runes`). Both this and `useTradingWalletBalance` take `{ params: { walletProvider, tradingAddress } }`. |
| `useRadfiAuth` | TData is `RadfiAuthResult = { accessToken, refreshToken, tradingAddress }` (3 fields — `publicKey` is persisted to localStorage but NOT returned). |
| All Bitcoin/Bound Exchange mutations | Standard pattern — drop hook-init args; pass through `mutate(vars)`. |

## Cross-references

- [`deleted-hooks.md`](deleted-hooks.md) — hooks that no longer exist at all.
- [`../breaking-changes/hook-signatures.md`](../breaking-changes/hook-signatures.md) — shape changes in detail.
- [`../features/`](../features/) — per-feature porting playbooks.
