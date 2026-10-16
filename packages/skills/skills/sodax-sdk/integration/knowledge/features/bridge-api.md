# Bridge API — `BridgeApiService`

Typed HTTP client for the backend **Bridge API** (`/bridge/*`). Reachable as `sodax.api.bridge`
(`sodax.api` is an alias for `sodax.backendApi`; `.bridge` is the `BridgeApiService` instance). One method
per endpoint. Every method returns `Promise<Result<T>>` — it **never throws** — and every
response is validated at runtime against a valibot schema, so a backend contract drift surfaces as
`{ ok: false }` rather than an untyped object.

Access: `sodax.api.bridge`. Service class: `BridgeApiService`. **Errors:** every failure (network, timeout,
non-2xx HTTP, or response-shape mismatch) returns `Result<T, SodaxError<'EXTERNAL_API_ERROR'>>` with
`feature: 'backend'`, `context.api: 'bridge'`, and `context.endpoint` (the path). The underlying failure
is preserved on `error.cause` — a `BridgeApiError` from the `@sodax/bridge-api` client this service wraps
(read its `code`: `NETWORK_ERROR` | `TIMEOUT_ERROR` | `HTTP_ERROR` | `PARSE_ERROR` | `VALIDATION_ERROR`;
the same code is mirrored on `error.context.code`, and both `BridgeApiError` and the `BridgeApiErrorCode`
union are re-exported from `@sodax/sdk`). Idempotent
reads/polls (and pure-compute POSTs like `getFee`) retry transient failures; mutating calls do not —
except the apiguard's transient key-verification `503`, which the wire client replays for every call
(the guard rejects before the handler runs). A `401`/`403` is terminal until the consumer fixes the key.
Like `sodax.api.swaps`, the bridge **HTTP client** is uniformly `feature: 'backend'`
(with a per-service `context.api` tag — `'bridge'`).

> Lower-level than `sodax.bridge` (the `BridgeService` orchestrator that deposits + relays end-to-end).
> Use `sodax.api.bridge` for a single backend call, or when building your own flow. The Bridge API is
> served on the base backend host — its routes are `/bridge/*` sub-paths under the same base URL.

## Methods

```ts
// Tokens
sodax.api.bridge.getTokens(config?): Promise<Result<GetBridgeTokensResponseV2>>;
sodax.api.bridge.getTokensByChain(chainKey, config?): Promise<Result<GetBridgeTokensByChainResponseV2>>;

// Allowance · approve · create intent — all three share the CreateBridgeIntentParamsV2 body
sodax.api.bridge.checkAllowance(body: CreateBridgeIntentParamsV2, config?): Promise<Result<BridgeAllowanceCheckResponseV2>>;
sodax.api.bridge.approve(body: CreateBridgeIntentParamsV2, config?): Promise<Result<BridgeApproveResponseV2>>;
sodax.api.bridge.createBridgeIntent(body: CreateBridgeIntentParamsV2, config?): Promise<Result<CreateBridgeIntentResponseV2>>;

// Submit-tx state machine
sodax.api.bridge.submitTx(body: BridgeSubmitTxRequestV2, config?): Promise<Result<BridgeSubmitTxResponseV2>>;
sodax.api.bridge.getSubmitTxStatus(query: BridgeSubmitTxStatusQueryV2, config?): Promise<Result<BridgeSubmitTxStatusResponseV2>>;

// Discovery / quote — read-only (computable client-side via sodax.bridge.*; mirrored here for HTTP parity)
sodax.api.bridge.getFee(body: BridgeFeeRequestV2, config?): Promise<Result<BridgeFeeResponseV2>>;
sodax.api.bridge.getBridgeableAmount(body: BridgeQuoteRequestV2, config?): Promise<Result<BridgeableAmountResponseV2>>;
sodax.api.bridge.isBridgeable(body: BridgeQuoteRequestV2, config?): Promise<Result<BridgeableCheckResponseV2>>;
```

The optional trailing `config?: RequestOverrideConfig` (`{ baseURL?, timeout?, headers? }`) on every method
applies per-call overrides that take precedence over the service config (same as the swaps client).

## Deltas vs the Swaps API

Bridge is **vault-backed, not solver-based**, so the surface is smaller and a few shapes differ:

- **No `intent` struct.** `createBridgeIntent` returns `{ tx, relayData }` (no `intent`); `submitTx` carries
  no `intent` field; there is no quote / deadline / limit-order / cancel / intent-hash / packet surface.
- **`submitTx.relayData` is the FULL `{ address, payload }` object** (not the `.payload` string the swaps
  client takes). Bridge has no `intent.creator` for the backend to rebuild the relay address, so the client
  must send the whole envelope — dropping the address breaks split-tx-chain relay (Stellar/Solana/Sui/Stacks).
- **Status lifecycle is 5-state** (`'pending'` → `'relaying'` → `'relayed'` → `'executed'` | `'failed'`) —
  no swaps `'posting_execution'`. Terminal success is `status === 'executed' && result.dstIntentTxHash`
  (no solver `intent_hash`). The status schema is tolerant of unknown states.
- **Param naming follows the swaps wire convention** (`inputToken`/`outputToken`/`inputAmount`/`srcAddress`/
  `dstAddress`), NOT the SDK-domain `srcToken`/`dstToken`/`amount`/`recipient`. The mapper
  `toCreateBridgeIntentParamsV2(params, extras?)` converts SDK-domain params (and serializes the `bigint`
  amount) to this wire DTO.
- **Discovery quotes (`getFee` / `getBridgeableAmount` / `isBridgeable`) are computable client-side** — prefer
  `sodax.bridge.getFee(...)` / `getBridgeableAmount(...)` / `isBridgeable({ from, to })` (no round-trip). They
  *also* have backend endpoints (listed above), mirrored on this client for non-SDK HTTP callers / parity.
  The token *list* is backend-served via `getTokens` / `getTokensByChain`.

## `approve` can return two transactions

`BridgeApproveResponseV2` is `{ tx, resetTx? }`. `resetTx` appears only when the source token rejects
an allowance change from one non-zero value to another (the 2017 TetherToken lineage) **and** the
wallet already holds a stale allowance — a wallet in that state cannot approve at all until it is
zeroed.

Broadcast `resetTx` first and wait for it to be mined, then broadcast `tx`. The two cannot be
batched: the approval is only valid once the reset has landed on-chain. Submitting `tx` while a
non-zero stale allowance remains is a guaranteed revert.

```ts
const { tx, resetTx } = approveResponse;

if (resetTx) {
  const resetHash = await sendTransaction(resetTx);
  await waitForTransactionReceipt(resetHash);
}

await sendTransaction(tx);
```

The field is optional and absent for every other token, so ignoring it keeps existing behaviour —
it just cannot rescue a wallet stuck on a guarded token.

## Common call shapes

### Allowance · approve · create intent (shared body)

```ts
const body = {
  srcChainKey, dstChainKey,
  inputToken,                 // source token address (SDK domain `srcToken`)
  outputToken,                // destination token address (SDK domain `dstToken`)
  inputAmount: '1000000',     // smallest unit, decimal string (SDK domain `amount`, bigint → string)
  srcAddress, dstAddress,     // dstAddress is the SDK domain `recipient`
};

const allowance = await sodax.api.bridge.checkAllowance(body);
if (allowance.ok && !allowance.value.valid) {
  const approved = await sodax.api.bridge.approve(body);
  if (!approved.ok) return;
  const { tx: approveTx, resetTx } = approved.value;   // broadcast resetTx first when present, then tx
  if (resetTx) {
    await waitForTransactionReceipt(await sendTransaction(resetTx));
  }
  await waitForTransactionReceipt(await sendTransaction(approveTx));
}

const created = await sodax.api.bridge.createBridgeIntent(body);
if (!created.ok) return;
const { tx, relayData } = created.value;                   // no `intent`
```

### Submit tx + poll status

```ts
// Sign + broadcast `tx` yourself, then hand the spoke tx hash back with the FULL relayData envelope.
const submit = await sodax.api.bridge.submitTx({
  txHash, srcChainKey, walletAddress,
  relayData,                       // the whole { address, payload } object, NOT relayData.payload
});
if (!submit.ok) return;

// Both txHash AND srcChainKey are required.
const status = await sodax.api.bridge.getSubmitTxStatus({ txHash, srcChainKey });
if (status.ok && status.value.data.status === 'executed') {
  status.value.data.result?.dstIntentTxHash;   // destination tx hash (no intent_hash)
}
// Lifecycle: 'pending' → 'relaying' → 'relayed' → 'executed' | 'failed'.
```

## Per-call overrides & custom endpoint

Every method accepts a trailing `RequestOverrideConfig` to redirect a single call or attach headers:

```ts
// `baseURL` is the gateway ROOT — the SDK appends `/bridge/*` itself. Never include a service segment.
await sodax.api.bridge.getTokens({ baseURL: 'https://staging.example/v1', headers: { 'X-Trace': 'abc' } });
```

The Bridge API has no dedicated config slice — it always shares the base backend host, reached as
`/bridge/*` on the gateway root (a sibling of the data API's `/be` mount, not a child of it). To
move the whole backend (including bridge) to a custom host, use the `CustomApiConfig` `baseApiConfig` slice
(see [`backend-api.md`](backend-api.md) § "Custom backend").

## Orchestrator integration — `bridge.useBackendSubmitTx`

`bridge.useBackendSubmitTx` (default `true`) routes the end-to-end `sodax.bridge.bridge()` through this
API (`submit-tx` + status poll) with an automatic fall back to the client-side relay on any non-success.
Set `new Sodax({ bridge: { useBackendSubmitTx: false } })` to force the client-side path. Independent of
`swaps.useBackendSubmitTx`. See [`bridge.md`](bridge.md) and the `CONFIGURE_SDK` doc.

## Error handling

```ts
const r = await sodax.api.bridge.createBridgeIntent(body);
if (!r.ok) {
  // r.error: SodaxError<'EXTERNAL_API_ERROR'> — feature: 'backend', context.api: 'bridge',
  // context.endpoint: '/bridge/intents'. The transport / shape-validation failure is on r.error.cause.
  return;
}
```

## Cross-references

- `sodax.bridge` (the `BridgeService` orchestrator that deposits + relays end-to-end): [`bridge.md`](bridge.md).
- `sodax.api.swaps` (the sibling swaps HTTP client this mirrors): [`swaps-api.md`](swaps-api.md).
- `BackendApiService` (intent / orderbook / money-market reads + config): [`backend-api.md`](backend-api.md).
- Error model context fields: [`../reference/error-codes.md`](../reference/error-codes.md).
