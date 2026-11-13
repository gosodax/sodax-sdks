# Swap migration — v1 → v2

Pure-SDK migration playbook for `SwapService`.

Pair: [`features/swap.md`](../../../integration/knowledge/features/swap.md).

## TL;DR

1. **Drop the `*SpokeProvider` argument.** Pass `walletProvider` directly into the SDK call payload alongside `params`.
2. **Pick the mode by call shape.** `{ params, walletProvider }` signs and broadcasts (`raw: false` is optional); `{ params, raw: true }` returns the unsigned tx. Passing neither, or both, fails to compile.
3. **Field renames on `CreateIntentParams<K>` and `CreateLimitOrderParams<K>`:**
   - `srcChain` → `srcChainKey`
   - `dstChain` → `dstChainKey`
   - **`Intent.srcChain` / `Intent.dstChain` are unchanged** (read shape) — they're `IntentRelayChainId` (bigint).
4. **`CreateIntentResult` shape changed.** v1 was a tuple `[spokeTxHash, intent, relayData]`; v2 is an object `{ tx, intent, relayData }`. Destructure accordingly.
5. **Backend submit-tx moved to `sodax.api.swaps.submitTx`** (`SubmitTxRequestV2`, was v1 `SubmitSwapTxRequest`): `srcChainId` → `srcChainKey`, and `relayData` expects a **string** (`relayData.payload`), not the `RelayExtraData` object.
6. **Errors → `SodaxError` + `Result<T>`.** v1's `IntentError<IntentErrorCode>` is gone. Branch on `result.ok`; use `(error.feature, error.code)` for discrimination.

## Type / symbol cheat sheet

### Field-level renames

| Type | v1 field | v2 field | Notes |
|---|---|---|---|
| `CreateIntentParams` (request) | `srcChain`, `dstChain` | `srcChainKey`, `dstChainKey` | Now generic: `CreateIntentParams<K extends SpokeChainKey>`. |
| `CreateLimitOrderParams` (request) | `srcChain`, `dstChain` | `srcChainKey`, `dstChainKey` | `Omit<CreateIntentParams<K>, 'deadline'>`. |
| `SubmitTxRequestV2` (backend req, was `SubmitSwapTxRequest`) | `srcChainId` | `srcChainKey` | Submitted via `sodax.api.swaps.submitTx`; `relayData: string` (was the object in v1). |
| `Intent` (read shape) | `srcChain`, `dstChain` | **unchanged** | `IntentRelayChainId` (bigint). Don't grep-replace blindly. |
| `XToken` | `xChainId` | `chainKey` | Type renamed from `Token` → `XToken`. |
| `CreateIntentResult` | tuple `[spokeTxHash, intent, relayData]` | object `{ tx, intent, relayData }` | Generic: `CreateIntentResult<K, Raw>`. |

### Deleted symbols

- The `SpokeProvider` union and per-chain `*SpokeProvider` classes — gone. v2 takes `walletProvider` directly. See [`../breaking-changes/architecture.md`](../breaking-changes/architecture.md) § 1.
- `IntentError<IntentErrorCode>` and `isIntentError` / `isIntentPostExecutionFailedError` / `isIntentSubmitTxFailedError` type guards. Replaced by `isSodaxError` + feature/code discrimination.
- `CustomProvider` (Hana wallet window typedecl) — declare `unknown` or import directly from the wallet vendor.
- `hubAssets` global — gone. `XToken.vault` and `XToken.hubAsset` baked in.

### v1 → v2 error code crosswalk (swap-specific)

| v1 `IntentErrorCode` | v2 `SodaxErrorCode` + context |
|---|---|
| `CREATE_INTENT_FAILED` | `INTENT_CREATION_FAILED` (`action: 'createIntent'`) |
| `CREATE_LIMIT_ORDER_FAILED` | `INTENT_CREATION_FAILED` (`action: 'createLimitOrder'`) |
| `POST_EXECUTION_FAILED` | `EXECUTION_FAILED` (`action: 'swap'`, `phase: 'postExecution'`) |
| `SOLVER_API_ERROR` | `EXTERNAL_API_ERROR` (`api: 'solver'`, with `solverCode`/`solverDetail` on context) |
| `SIMULATION_FAILED` | `EXECUTION_FAILED` (`phase: 'execution'`) |
| `SUBMIT_TX_FAILED` (relay) | `TX_SUBMIT_FAILED` (`relayCode: 'SUBMIT_TX_FAILED'`) |
| `RELAY_TIMEOUT` | `RELAY_TIMEOUT` (unchanged code; still on `relayCode`) |

## Per-method delta

### `swap`

```diff
- await sodax.swaps.swap({
-   intentParams,
-   spokeProvider: sourceSpokeProvider,
- });
+ const result = await sodax.swaps.swap({
+   params: intentParams,
+   raw: false,
+   walletProvider: sourceWalletProvider,
+ });
+ if (!result.ok) return;
+ const { solverExecutionResponse, intent, intentDeliveryInfo } = result.value;
+ // swap() returns SwapResponse = { solverExecutionResponse, intent, intentDeliveryInfo }
```

### `createIntent`

```diff
- const [spokeTxHash, intent, relayData] = await sodax.swaps.createIntent({
-   intentParams,
-   spokeProvider: sourceSpokeProvider,
- });
+ const result = await sodax.swaps.createIntent({
+   params: intentParams,
+   raw: false,
+   walletProvider: sourceWalletProvider,
+ });
+ if (!result.ok) return;
+ const { tx: spokeTxHash, intent, relayData } = result.value;
```

### `createLimitOrder`

Same as `createIntent` shape (with `CreateLimitOrderParams`). v1 took `{ limitOrderParams, spokeProvider }`; v2 takes `{ params, raw: false, walletProvider }`.

### `cancelIntent` / `cancelLimitOrder`

```diff
- await sodax.swaps.cancelIntent({ srcChain, intent, spokeProvider });
+ await sodax.swaps.cancelIntent({
+   params: { srcChainKey, intent },
+   raw: false,
+   walletProvider,
+ });
```

### `approve` / `isAllowanceValid`

v1: `await sodax.swaps.approve({ intentParams, spokeProvider })`.
v2: `await sodax.swaps.approve({ params: intentParams, raw: false, walletProvider })`.

For `isAllowanceValid` in **read-only** flows (e.g. UI polling), use `raw: true` to skip the wallet-provider requirement:

```ts
const result = await sodax.swaps.isAllowanceValid({ params, raw: true });
```

The underlying read doesn't consult the wallet provider; `raw: true` is the contract for read-only access.

### Backend submit-tx (`SubmitTxRequestV2`)

```diff
- const request: SubmitSwapTxRequest = {
+ const request: SubmitTxRequestV2 = {
    txHash: spokeTxHash as string,
-   srcChainId: sourceChain,
+   srcChainKey: src.chain,
    walletAddress: sourceAccount.address ?? '',
-   intent: swapIntentData,          // was: V1 string/number-downcast shape
+   intent,                          // IntentRequestV2 — the createIntent intent passes through (bigint)
-   relayData,                       // was the RelayExtraData object
+   relayData: relayData.payload,    // now a string
  };
- const submitResult = await sodax.backendApi.submitSwapTx(request);
+ const submitResult = await sodax.api.swaps.submitTx(request);   // moved off BackendApiService
  if (!submitResult.ok) return;
```

## Worked example — `handleSubmitTxSwap` flow

```diff
  const handleSubmitTxSwap = async (intentOrderPayload: CreateIntentParams) => {
-   if (!sourceProvider) return;
+   if (!sourceWalletProvider) return;
-   const createIntentResult = await sodax.swaps.createIntent({
-     intentParams: intentOrderPayload,
-     spokeProvider: sourceProvider,
-   });
+   const createIntentResult = await sodax.swaps.createIntent({
+     params: intentOrderPayload,
+     raw: false,
+     walletProvider: sourceWalletProvider,
+   });
    if (!createIntentResult.ok) return;
-   const [spokeTxHash, intent, relayData] = createIntentResult.value;
+   const { tx: spokeTxHash, intent, relayData } = createIntentResult.value;
-   const swapIntentData: SwapIntentData = {
-     /* … string/number downcasts of intent.* … */
-     srcChain: Number(intent.srcChain),
-     dstChain: Number(intent.dstChain),
-   };
-   const request: SubmitSwapTxRequest = {
+   const request: SubmitTxRequestV2 = {
      txHash: spokeTxHash as string,
-     srcChainId: sourceChain,
+     srcChainKey: src.chain,
      walletAddress: sourceAccount.address ?? '',
-     intent: swapIntentData,
+     intent,                         // IntentRequestV2 — bigint fields pass through, no downcast
-     relayData,
+     relayData: relayData.payload,
    };
-   await submitSwapTx(request);
+   const submitResult = await sodax.api.swaps.submitTx(request);
+   if (!submitResult.ok) return;
  };
```

## Pitfalls

Cross-cutting traps (Result destructuring, error-model migration, srcChain/dstChain renames, etc.) live in [`../ai-rules.md`](../ai-rules.md). The list below is feature-specific — typecheck fingerprints, return-shape diffs, and gotchas unique to this feature.

1. **Over-broad regex on `srcChain` / `dstChain`.** Request types renamed; `Intent` (read shape) didn't. Distinguish "I'm building a request" from "I'm reading an intent."
2. **`createIntent` success shape changed from tuple to object.** `{ tx, intent, relayData }`, not `[spokeTxHash, intent, relayData]`.
3. **`relayData` on `SubmitTxRequestV2` is a `string`.** It's `relayData.payload`, not the full `RelayExtraData` object.
4. **`spokeTxHash` is `TxReturnType<K, false>`, not necessarily `string`.** For most chains it's a string already, but the SDK type is broader. Cast at the boundary when passing to APIs that strictly want `string`: `txHash: spokeTxHash as string`.
5. **`Intent.deadline` is `bigint`.** `Math.floor(Date.now() / 1000) + 60 * 5` returns a number; wrap in `BigInt(...)`.
6. **`IntentResponse.srcChain` / `dstChain` from the backend are `IntentRelayChainId` (number/bigint), not chain keys.** Convert via `sodax.config.getSpokeChainKeyFromIntentRelayChainId(BigInt(intent.dstChain))` when displaying.
7. **`hubAssets` is gone.** Anything that walked `hubAssets[chainId]` for vault lookup must use `XToken.vault` (now baked in) or `sodax.config.getOriginalAssetAddress()`.
8. **`SodaxConfig.swaps` vs `.solver`.** v1 mixed solver endpoints under `swaps`; v2 splits — `swaps` for supported tokens, `solver` for endpoints. See [`../breaking-changes/architecture.md`](../breaking-changes/architecture.md) Appendix B.

## Verification

After migrating swap call sites:

```bash
# Should produce zero errors when the migration is complete:
pnpm -C <your-app-dir> checkTs

# Targeted scan for leftover v1 patterns:
grep -rE "spokeProvider:\s*\w+|intentParams:\s*\w+|srcChain:\s*\w+\.[a-z]+ChainId" src/
grep -rE "isIntentError\b|isIntentPostExecutionFailedError\b|isIntentSubmitTxFailedError\b" src/
```

## Cross-references

- v2 swap usage: [`features/swap.md`](../../../integration/knowledge/features/swap.md).
- Cross-cutting prerequisites (type-system, architecture, result/errors) listed in [`../README.md`](../README.md).
