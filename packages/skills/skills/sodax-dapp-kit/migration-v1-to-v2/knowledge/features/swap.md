# Swap migration — v1 → v2 (dapp-kit)

Pair: [`features/swap.md`](../../../integration/knowledge/features/swap.md).

## TL;DR

> Cross-cutting conventions (drop `spokeProvider`, single-object hook init, `mutate(vars)` for domain inputs, `mutateAsyncSafe` ergonomics) — see [`../breaking-changes/hook-signatures.md`](../breaking-changes/hook-signatures.md) and [`../breaking-changes/result-handling.md`](../breaking-changes/result-handling.md). Feature-specific deltas below:

1. **Drop `spokeProvider` from `useSwap` and `useSwapApprove` hook init.** Pass `walletProvider` (from `useWalletProvider({ xChainId: chainKey })`) into `mutate(vars)`.
2. **`useSwapAllowance({ params: { payload, srcChainKey, walletProvider } })`** — query inputs all nest under `params` (no top-level `spokeProvider` or `walletProvider`); the SDK request goes under `params.payload`.
3. **Approve hook return shape changed.** `{ approve, isLoading } = useSwapApprove(...)` → `{ mutateAsync: approve, isPending } = useSwapApprove()`.
4. **`mutationFn` throws on SDK `!ok`.** Either wrap `mutateAsync` in `try/catch` or use `mutateAsyncSafe` for `Result<T>` branching.
5. **Field on `Intent` read shape kept its name.** `Intent.srcChain` / `Intent.dstChain` are still `IntentRelayChainId` (bigint) — distinct from request-side `srcChainKey` / `dstChainKey` on action params.
6. **`useStatus({ params: { intentTxHash } })` — single-object query shape.** v1's positional version is gone. Key was renamed `intentHash → intentTxHash`. Return is `Result<SolverIntentStatusResponse, SolverErrorResponse> | undefined` — branch on `data?.ok` before reading status fields.

## Per-method delta

### `useSwap` — execute swap

```diff
  function SwapButton({ intentParams }: { intentParams: CreateIntentParams }) {
-   const swap = useSwap(spokeProvider);
+   const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
+   const { mutateAsyncSafe: swap, isPending } = useSwap();

    const handleSwap = async () => {
+     if (!walletProvider) return;
-     const result = await swap.mutateAsync({ params: intentParams });
-     if (result.ok) {
-       // v1: result.value was a TUPLE — destructure positionally
-       const [executionResponse] = result.value;
-       const txHash = executionResponse.intent_hash;
-       /* ... */
-     } else {
-       toast.error(result.error.message);
-     }
+     const result = await swap({ params: intentParams, walletProvider });
+     if (!result.ok) {
+       toast.error(result.error instanceof Error ? result.error.message : 'Swap failed');
+       return;
+     }
+     // v2: result.value is a NAMED OBJECT (SwapResponse) — destructure by name
+     const { solverExecutionResponse, intent, intentDeliveryInfo } = result.value;
+     const intentHash = solverExecutionResponse.intent_hash;       // protocol-level intent id (v1 ≈ executionResponse.intent_hash)
+     const spokeTxHash = intentDeliveryInfo.srcTxHash;             // on-chain tx hash on srcChainKey — use for tx-history display
+     /* ... */
    };
  }
```

#### `SwapResponse` field map (`result.value`)

| Field | Type | Use it for |
|---|---|---|
| `solverExecutionResponse` | `{ answer: 'OK'; intent_hash: Hex }` | Protocol-level intent identifier. **`solverExecutionResponse.intent_hash` is the v2 equivalent of v1's `executionResponse.intent_hash`.** Pass it to `useStatus({ params: { intentTxHash } })` to poll execution status. |
| `intent` | `Intent` | Intent metadata (`intentId: bigint`, `creator`, tokens, amounts, `srcChain`/`dstChain` as `IntentRelayChainId` bigints). **No transaction hashes on this object** — don't read `intent.intent_hash` (does not exist) or `intent.tx_hash`. |
| `intentDeliveryInfo` | `{ srcChainKey, srcTxHash, srcAddress, dstChainKey, dstTxHash, dstAddress }` | **On-chain transaction hashes.** `srcTxHash` is the spoke-chain tx on `srcChainKey` (the one that typically feeds a user-facing transaction history); `dstTxHash` is the delivery tx on `dstChainKey`. |

**Porting `[executionResponse] = result.value` (v1 tuple) → v2:** rename to `{ solverExecutionResponse } = result.value`. Any `executionResponse.intent_hash` read becomes `solverExecutionResponse.intent_hash`. If the value was being used as the **transaction hash** in a transaction-history row (not as the intent identifier), switch to `intentDeliveryInfo.srcTxHash` instead — `intent_hash` and `srcTxHash` are not interchangeable.

### `useSwapApprove` — return shape

```diff
- const { approve, isLoading, error } = useSwapApprove(spokeProvider);
- await approve(intentParams);
+ const { mutateAsync: approve, isPending, error } = useSwapApprove();
+ await approve({ params: intentParams, walletProvider });
```

`isLoading` → `isPending` (React Query 5 convention).

### `useSwapAllowance` — payload + srcChainKey + walletProvider all under `params`

```diff
- const { data: allowanceResult } = useSwapAllowance({ params: intentParams, spokeProvider });
+ const { data: isApproved } = useSwapAllowance({
+   params: { payload: intentParams, srcChainKey: ChainKeys.BSC_MAINNET, walletProvider },
+ });
+ // `data` is `boolean | undefined` (already unwrapped); no `.ok` branch needed.
```

### `useStatus` — single-object shape + param renamed `intentHash → intentTxHash`

```diff
- const { data: status } = useStatus(intentHash);
+ const { data: status } = useStatus({ params: { intentTxHash } });
+ // `data` is `Result<SolverIntentStatusResponse, SolverErrorResponse> | undefined` —
+ // branch on `data?.ok` before reading `data.value.<fields>`.
```

### `useQuote` — single-object shape + SDK request nested under `params.payload`

```diff
- const { data: quote } = useQuote({
-   token_src: SRC_TOKEN,
-   token_dst: DST_TOKEN,
-   token_src_blockchain_id: BSC_MAINNET_CHAIN_ID,
-   token_dst_blockchain_id: ARBITRUM_MAINNET_CHAIN_ID,
-   amount,
-   quote_type: 'exact_input',
- });
+ const { data: quote } = useQuote({
+   params: {
+     payload: {
+       token_src: SRC_TOKEN,
+       token_dst: DST_TOKEN,
+       token_src_blockchain_id: ChainKeys.BSC_MAINNET,
+       token_dst_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
+       amount,
+       quote_type: 'exact_input',
+     },
+   },
+ });
```

`SolverIntentQuoteRequest` shape unchanged. Two v2 changes: SDK request is nested under `params.payload` (not directly under `params`); constants renamed (`*_MAINNET_CHAIN_ID` → `ChainKeys.X_MAINNET`).

### `useCreateLimitOrder` / `useCancelLimitOrder` / `useCancelSwap`

Same shape changes as `useSwap` — drop `spokeProvider`, move domain inputs to `mutate(vars)`.

## Pitfalls

1. **`Intent.srcChain` / `Intent.dstChain` look like they should rename.** They didn't. Those are read-shape `IntentRelayChainId` (bigint), distinct from request-side `srcChainKey` / `dstChainKey`. Don't grep-replace.
2. **`useStatus` polling default.** v2 polls every 3 s once `intentTxHash` is supplied, then stops on status `3` (SOLVED) / `4` (FAILED), and after 40 consecutive successful fetches while status stays `-1` (NOT_FOUND). In-flight `1` / `2` reset that streak and keep polling. Override with `queryOptions.refetchInterval`. Port any v1 custom polling to `queryOptions.refetchInterval`.
3. **`useQuote` data is `Result<T>`** — branch on `data?.ok` before reading `data.value.quoted_amount`.

## Cross-references

- [`features/swap.md`](../../../integration/knowledge/features/swap.md) — v2 reference.
- [`recipes/swap.md`](../../../integration/knowledge/recipes/swap.md) — full v2 worked example.
- [`../breaking-changes/hook-signatures.md`](../breaking-changes/hook-signatures.md), [`../breaking-changes/result-handling.md`](../breaking-changes/result-handling.md) — cross-cutting deltas.
- `sodax-sdk`: `migration-v1-to-v2/knowledge/features/swap.md` — underlying SDK swap migration.
