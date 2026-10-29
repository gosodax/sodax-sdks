# Swap — `@sodax/dapp-kit`

Cross-chain token swaps via the intent-based solver.

Pair: [`features/swap.md`](../../../migration-v1-to-v2/knowledge/features/swap.md).

## Hook surface

```ts
// @ai-snippets-skip
// New in 2.3.0 (not in 2.2.0): useSwapApprovalStrategy, useSwapWithApproval
// Queries — note the nested `params.payload` shape on useQuote and useSwapAllowance.
// `payload` is the SDK request value (SolverIntentQuoteRequest, CreateIntentParams, etc.).
useQuote({ params: { payload }, queryOptions });                                  // Real-time quote (3s)
useSwapAllowance({ params: { payload, srcChainKey, walletProvider }, queryOptions }); // allowance (2s)
useStatus({ params: { intentTxHash }, queryOptions });                            // Intent execution status (3s)
// Polls 3s; stops on a terminal source, a rejected API key, or 40 consecutive ambiguous reads.
useDetailedStatus({ params: { srcChainKey, srcTxHash }, queryOptions });          // Swap status by source tx (3s)
useSwapApprovalStrategy({ params: { payload, walletProvider }, queryOptions });    // 'not-required' | 'atomic-batch' | 'sequential' (no polling)

// Mutations — domain inputs flow through mutate(vars), see Mutation params below
useSwap({ mutationOptions });
useSwapApprove({ mutationOptions });
useSwapWithApproval({ mutationOptions });           // useSwap + approval; one EIP-5792 signature when the wallet can batch

// Composite — the whole form as one state machine; see recipes/swap.md § One Hook for the Whole Form
useSwapLifecycle({ intentParams, srcWalletProvider, dstWalletProvider, chainSwitch?, externalBlocked?, extras?, timeout?, mutationOptions? });
//   → { state, error, next, reset, approvalStrategy, swap, status, stellar, nearStorage }
//   the Stellar and NEAR gates check intentParams.dstAddress; dstWalletProvider must control it for the setup actions
//   state.kind: idle | checking | needsChainSwitch | needsSetup(reason) | ready(approvalStrategy) | submitting
//               | pending (error? after a post-broadcast failure) | unconfirmed (batch may still land — next() re-checks it, never re-sends) | settled | failed
useCancelSwap({ mutationOptions });                  // TVars are FLAT: { srcChainKey, intent, walletProvider }
useCreateLimitOrder({ mutationOptions });           // No deadline; cancel manually
useCancelLimitOrder({ mutationOptions });           // TVars are FLAT: { srcChainKey, intent, walletProvider }
```

(In actual code, you import each hook directly: `import { useSwap, useSwapAllowance, ... } from '@sodax/dapp-kit'`.)

`use*Approve` is unchanged and still resolves to one transaction hash, but the SDK may send **two**
transactions on a token that rejects a non-zero to non-zero allowance change (Ethereum USDT today) —
the user signs twice and the hash is the **last** one's. An `isPending`-driven "Approving…" should say
so. See "Approve hooks can prompt the wallet twice" in [`architecture.md`](../architecture.md).

## Mutation params

```ts
// @ai-snippets-skip
const { mutateAsyncSafe: swap } = useSwap();

// vars shape (TVars):
type UseSwapVars<K extends SpokeChainKey = SpokeChainKey> = Omit<SwapActionParams<K, false>, 'raw'>;
// = { params: CreateIntentParams; walletProvider: GetWalletProviderType<K>;
//     extras?; timeout?; skipSimulation? }  // extras: per-action partnerFee / apiKey overrides

const result = await swap({ params: intentParams, walletProvider });
```

`vars` also carries the SDK's optional exec fields: `timeout` (per-attempt relay budget),
`skipSimulation`, and `extras` — per-action overrides of the configured swap `partnerFee` and the
backend API key (`extras.apiKey`, sent as `x-api-key` on the backend submit-tx leg). Both fall back to
the `SodaxProvider` config when omitted.

`useSwapApprove` follows the same `{ params, walletProvider }` shape via `mutate(vars)`, where `params` is `CreateIntentParams<K> | CreateLimitOrderParams<K>` (the union — limit-order params also flow through `useSwapApprove`).

`useCreateLimitOrder` takes `{ params: CreateLimitOrderParams; walletProvider }` (no deadline; the order persists until cancelled).

**Cancel hooks are flat** (no `params` wrapper):
- `useCancelSwap` takes `{ srcChainKey, intent, walletProvider }`.
- `useCancelLimitOrder` takes `{ srcChainKey, intent, walletProvider }`.

## Query params

```ts
// @ai-snippets-skip
// useQuote — SDK request wrapped under params.payload
type UseQuoteParams = ReadHookParams<
  Result<SolverIntentQuoteResponse, SolverErrorResponse> | undefined,
  { payload: SolverIntentQuoteRequest | undefined }
>;

// useSwapAllowance — payload + srcChainKey + walletProvider all nested under params
type UseSwapAllowanceParams<K extends SpokeChainKey> = ReadHookParams<
  boolean,
  {
    payload: CreateIntentParams | CreateLimitOrderParams | undefined;
    srcChainKey: K | undefined;
    walletProvider: GetWalletProviderType<K> | undefined;
  }
>;

// useStatus — flat (no payload wrapper). Key is `intentTxHash` (NOT `intentHash`).
// Return is Result-wrapped, like useQuote — branch on data?.ok before reading status fields.
type UseStatusParams = ReadHookParams<
  Result<SolverIntentStatusResponse, SolverErrorResponse> | undefined,
  { intentTxHash: Hex | undefined }
>;

// useDetailedStatus — keyed on the SOURCE tx (useStatus takes the HUB tx). Also Result-wrapped.
type UseDetailedStatusParams = ReadHookParams<
  Result<DetailedSwapStatus, DetailedStatusError> | undefined,
  { srcChainKey: SpokeChainKey | undefined; srcTxHash: string | undefined }
>;
// DetailedSwapStatus is a tagged union — narrow on `source`, do not read `.status` off the top level:
//   { source: 'backend'; data: SubmitTxStatusDataV2 }
// | { source: 'solver'; dstTxHash: Hex; data: SolverIntentStatusResponse }
```

## Return shapes

| Hook | Returns |
|---|---|
| `useSwap` | `SafeUseMutationResult<SwapResponse, Error, UseSwapVars>` where `SwapResponse = { intent, intentDeliveryInfo, solverExecutionResponse }` |
| `useSwapApprove` | `SafeUseMutationResult<TxReturnType<K, false>, Error, UseSwapApproveVars<K>>` — chain-keyed receipt union (EVM/Stellar/Sui differ) |
| `useCancelSwap` | `SafeUseMutationResult<TxHashPair, Error, { srcChainKey, intent, walletProvider }>` — note FLAT TVars |
| `useCancelLimitOrder` | `SafeUseMutationResult<TxHashPair, Error, { srcChainKey, intent, walletProvider }>` — note FLAT TVars |
| `useCreateLimitOrder` | `SafeUseMutationResult<{ intent, intentDeliveryInfo, ... }, Error, ...>` |
| `useQuote` | `UseQueryResult<Result<SolverIntentQuoteResponse, SolverErrorResponse> \| undefined, Error>` — `data?.ok` branching required; polls 3 s |
| `useSwapAllowance` | `UseQueryResult<boolean, Error>` — `data` is already-unwrapped `boolean \| undefined`; truthy when approved; polls 2 s |
| `useStatus` | `UseQueryResult<Result<SolverIntentStatusResponse, SolverErrorResponse> \| undefined, Error>` — Result-wrapped like `useQuote`; `data?.ok` branching required; polls 3 s; stops on status `3`/`4`, and after 40 consecutive NOT_FOUND fetches |
| `useDetailedStatus` | `UseQueryResult<Result<DetailedSwapStatus, DetailedStatusError> \| undefined, Error>` — Result-wrapped tagged union; polls 3 s; stops when the answering source is terminal (backend `'solved'`, or solver `SOLVED`/`FAILED`), when the backend rejects the API key, and — like `useStatus` — after 40 consecutive ambiguous reads (solver `NOT_FOUND`, or a relay with no packet for the tx); a dependency outage keeps polling |

### `useStatus` vs `useDetailedStatus`

Different transactions — pick by which hash you hold:

- `useStatus` takes the **hub** tx hash (`intentDeliveryInfo.dstTxHash`) and always asks the solver.
- `useDetailedStatus` takes the **source** tx hash plus chain key (`intentDeliveryInfo.srcTxHash` + `srcChainKey`) and routes to whichever source can answer.

`useDetailedStatus` invents no status of its own — it returns the backend submit-tx record while that is in play, otherwise the solver's answer, tagged with `source`. The union is discriminated, so narrow on the field (no type guards are exported):

```ts
// @ai-snippets-skip
if (data?.ok) {
  if (data.value.source === 'backend') data.value.data.status;      // 'pending' | … | 'solved' | 'failed'
  if (data.value.source === 'solver') data.value.data.status;       // SolverIntentStatusCode
}
```

To render it without switching on `source`, collapse it with `summarizeSwapStatus` (from `@sodax/sdk`, re-exported here) — `{ state: 'pending' | 'solved' | 'failed'; hubTxHash?; fillTxHash? }`. `fillTxHash` may be absent even when solved.

**Default to `useDetailedStatus`.** It is the only swap status read that answers for every completion path, and it takes the identifiers `swap()` hands back on success (`intentDeliveryInfo.srcChainKey` / `srcTxHash`) and on a post-broadcast failure (`error.context.srcChainKey` / `srcTxHash`).

That is what distinguishes it from `useSwapsApiSubmitTxStatus`, which reads the backend record directly — 404 when none exists, and a stale or abandoned record for a swap the client-side fallback completed. A swap whose relay packet has not landed has no hub tx hash and reads as `LOOKUP_FAILED`; that spends the same 40-read budget as a solver `NOT_FOUND`, so a swap nothing can resolve stops instead of polling forever. A dependency outage does **not** spend the budget — it keeps polling so the read recovers on its own.

### `useSwapWithApproval` — approve and swap in one signature

> New in 2.3.0 (not in 2.2.0): `useSwapWithApproval`.

Same vars as `useSwap`. It calls `sodax.swaps.swapWithApproval` (new in 2.3.0): no approval when the allowance suffices; on an EVM
spoke whose wallet reports EIP-5792 atomic support, approve + swap as **one batch, one signature**; otherwise approve,
wait for it to confirm, then swap. `data.approvalStrategy` says which ran. Pair it with `useSwapApprovalStrategy` (new in 2.3.0) to
label the button up front (e.g. "Approve & Swap" vs "Approve, then Swap"), instead of the
`useSwapAllowance` + `useSwapApprove` + `useSwap` trio. A rejected batch — or a declined account upgrade on a
`'ready'` wallet — is `USER_REJECTED` and is **not** retried as two transactions. A declined upgrade carries
`context.reason === ACCOUNT_UPGRADE_DECLINED` (new in 2.3.0); pass `allowAccountUpgrade: false` (in the mutation vars and to
`useSwapApprovalStrategy` (new in 2.3.0)) to swap without the upgrade. dapp-kit never stores that choice — the app decides.

## Gotchas

1. **`Intent.srcChain` and `Intent.dstChain` keep their v1 names.** Even though request-side params use `srcChainKey`/`dstChainKey`, the read-side `Intent` type didn't rename. Don't blanket-replace these names.
2. **Default `mutationKey` is `['swap']`.** Use `useIsMutating({ mutationKey: ['swap'] })` to get a global "any swap in flight" state. Override via `mutationOptions.mutationKey` if you want narrower scoping per-call.
3. **Quotes auto-refresh every 3s** — pause polling by setting `queryOptions.refetchInterval: false` if the quote is in a non-visible UI.
4. **Token list has duplicate addresses across chains.** `sodax.swaps.getSupportedSwapTokens()` returns `Record<SpokeChainKey, readonly XToken[]>`. Flattening it (e.g. `Object.values(...).flat()`) yields multiple tokens that share a contract address (same token deployed on different chains). When rendering a flat token list, use a composite key like `${token.address}-${token.chainKey}` — not `token.address` alone. (`XToken` carries `chainKey`; there is no `blockchain_id` field.)

## Cross-references

- [`../recipes/swap.md`](../recipes/swap.md) — full worked example.
- [`../recipes/mutation-error-handling.md`](../recipes/mutation-error-handling.md) — call-shape patterns.
- [`features/swap.md`](../../../migration-v1-to-v2/knowledge/features/swap.md) — v1 → v2 porting.
- `sodax-sdk`: `integration/knowledge/features/swap.md` — underlying SDK swap surface.
