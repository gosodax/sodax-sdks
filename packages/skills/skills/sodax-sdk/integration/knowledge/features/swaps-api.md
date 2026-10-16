# Swaps API — `SwapsApiService`

Typed HTTP client for the backend **Swaps API** (`/swaps/*`). Reachable as `sodax.api.swaps`
(`sodax.api` is an alias for `sodax.backendApi`; `.swaps` is the `SwapsApiService` instance). One method
per endpoint (21 total). Every method returns `Promise<Result<T>>` — it **never throws** — and every
response is validated at runtime against a valibot schema, so a backend contract drift surfaces as
`{ ok: false }` rather than an untyped object.

Access: `sodax.api.swaps`. Service class: `SwapsApiService`. **Errors:** every failure (network, timeout,
non-2xx HTTP, or response-shape mismatch) returns `Result<T, SodaxError<'EXTERNAL_API_ERROR'>>` with
`feature: 'backend'`, `context.api: 'swaps'`, and `context.endpoint` (the path). The underlying failure
is preserved on `error.cause` — a `SwapsApiError` from the `@sodax/swaps-api` client this service wraps
(read its `code`: `NETWORK_ERROR` | `TIMEOUT_ERROR` | `HTTP_ERROR` | `PARSE_ERROR` | `VALIDATION_ERROR`;
the same code is mirrored on `error.context.code`, and both `SwapsApiError` and the `SwapsApiErrorCode`
union are re-exported from `@sodax/sdk`). Idempotent
reads/polls (and pure-compute POSTs like `getQuote`) retry transient failures; mutating calls do not.
This differs from the feature services (`sodax.swaps`, etc.), whose errors carry their own `feature`
(`'swap'`, …) — the swaps **HTTP client** is uniformly `feature: 'backend'`.

## Methods

```ts
// Tokens
sodax.api.swaps.getTokens(config?): Promise<Result<GetSwapTokensResponseV2>>;
sodax.api.swaps.getTokensByChain(chainKey, config?): Promise<Result<GetSwapTokensByChainResponseV2>>;

// Quote · deadline
sodax.api.swaps.getQuote(body: QuoteRequestV2, query?: QuoteQueryV2, config?): Promise<Result<QuoteResponseV2>>;
sodax.api.swaps.getDeadline(query?: DeadlineQueryV2, config?): Promise<Result<DeadlineResponseV2>>;

// Allowance · approve · create intent — all three share the CreateIntentParamsV2 body
sodax.api.swaps.checkAllowance(body: CreateIntentParamsV2, config?): Promise<Result<AllowanceCheckResponseV2>>;
sodax.api.swaps.approve(body: CreateIntentParamsV2, config?): Promise<Result<ApproveResponseV2>>;
sodax.api.swaps.createIntent(body: CreateIntentParamsV2, config?): Promise<Result<CreateIntentResponseV2>>;

// Intent lifecycle: submit · status · cancel · hash · packet · extra-data · fill · get
sodax.api.swaps.submitIntent(body: SubmitIntentRequestV2, config?): Promise<Result<SubmitIntentResponseV2>>;
sodax.api.swaps.getStatus(body: StatusRequestV2, config?): Promise<Result<StatusResponseV2>>;
sodax.api.swaps.cancelIntent(body: CancelIntentRequestV2, config?): Promise<Result<CancelIntentResponseV2>>;
sodax.api.swaps.getIntentHash(body: IntentHashRequestV2, config?): Promise<Result<IntentHashResponseV2>>;
sodax.api.swaps.getSolvedIntentPacket(body: IntentPacketRequestV2, config?): Promise<Result<IntentPacketResponseV2>>;
sodax.api.swaps.getIntentSubmitTxExtraData(body: IntentExtraDataRequestV2, config?): Promise<Result<IntentExtraDataResponseV2>>;
sodax.api.swaps.getFilledIntent(txHash, config?): Promise<Result<IntentStateV2>>;
sodax.api.swaps.getIntent(txHash, config?): Promise<Result<GetIntentResponseV2>>;

// Limit orders · gas · fees
sodax.api.swaps.createLimitOrderIntent(body: CreateLimitOrderParamsV2, config?): Promise<Result<CreateLimitOrderResponseV2>>;
sodax.api.swaps.estimateGas(body: GasEstimateRequestV2, config?): Promise<Result<GasEstimateResponseV2>>;
sodax.api.swaps.getPartnerFee(query: FeeQueryV2, config?): Promise<Result<FeeResponseV2>>;
sodax.api.swaps.getSolverFee(query: FeeQueryV2, config?): Promise<Result<FeeResponseV2>>;

// Submit-tx state machine
sodax.api.swaps.submitTx(body: SubmitTxRequestV2, config?): Promise<Result<SubmitTxResponseV2>>;
sodax.api.swaps.getSubmitTxStatus(query: SubmitTxStatusQueryV2, config?): Promise<Result<SubmitTxStatusResponseV2>>;
```

The optional trailing `config?: RequestOverrideConfig` (`{ baseURL?, timeout?, headers?, apiKey? }`) on every method
applies per-call overrides that take precedence over the service config (see "Per-call overrides" below).

## `approve` can return two transactions

`ApproveResponseV2` is `{ tx, resetTx? }`. `resetTx` appears only when the source token rejects an
allowance change from one non-zero value to another (the 2017 TetherToken lineage) **and** the wallet
already holds a stale allowance — a wallet in that state cannot approve at all until it is zeroed.

Broadcast `resetTx` first and wait for it to be mined, then broadcast `tx`. The two cannot be
batched: the approval is only valid once the reset has landed on-chain.

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

## Wire shapes — `bigint` vs decimal strings

Request bodies that carry an `intent` struct (`cancelIntent`, `getIntentHash`,
`getIntentSubmitTxExtraData`, `submitTx`) take `IntentRequestV2`, whose numeric fields
(`intentId`, `inputAmount`, `minOutputAmount`, `deadline`, `srcChain`, `dstChain`) are **`bigint`**; the
client serializes them to decimal strings on the wire. Server-returned intents (`IntentResponseV2`) come
back with those fields as decimal **`string`** (outbound JSON can't carry bigint). The `amount` /
`inputAmount` fields on the quote / create-intent request bodies are already decimal **strings**.

## `partnerFee`

Optional on the type, but no default: the backend does not fill it in, and
`new Sodax({ fee })` / `new Sodax({ swaps: { partnerFee } })` only reach the
`sodax.swaps` orchestrator — not this wire path. Send the same value on quote and
create-intent. `checkAllowance` / `approve` inherit the field but ignore it.
The Bridge API is different: omitted `partnerFee` falls back to `bridgePartnerFee`.

## API key

The backend guards `POST /swaps/*` routes with an `x-api-key` header check (keys come from the partner
portal). Unlike `partnerFee`, the config-level key DOES reach this wire path: there is ONE
instance-wide key, `new Sodax({ apiKey })`, sent on every backend request — this client,
`sodax.backendApi`, `sodax.api.bridge`, the solver API, and the backend submit-tx legs of `swap()` /
`bridge()`. There is no per-feature or per-slice swaps key. Override per call via the trailing
`RequestOverrideConfig`:

```ts
// Server-side only — a key in a browser bundle is public
await sodax.api.swaps.createIntent(body, { apiKey: 'per-request-key' });
```

The key belongs on a server. Never read it from `NEXT_PUBLIC_*` / `VITE_*` / `REACT_APP_*` — those are
inlined into the client bundle. When the SDK runs in a browser, point `api.baseURL` and
`solver.solverApiEndpoint` at the app's own backend proxy and attach the key there: https://docs.sodax.com/developers/how-to/api-key-good-practices.

Precedence, highest first: per-call `headers['x-api-key']` (any casing) → per-call `apiKey` → a
configured explicit `x-api-key` header (`api.headers` / `setHeaders`) → the configured `apiKey`. That
full order is what the data, swaps, and bridge transports resolve; sponsoring's tier 3 is its own
slice/runtime headers (shared `api.headers` / `backendApi.setHeaders` never reach it — rotate via
`sodax.api.sponsoring.setHeaders`), and the solver API has no per-call override surface and no
configured-header slot, so it carries the configured `apiKey` alone. An empty `apiKey` counts as unset
and falls back. Read the configured value back on `sodax.config.apiKey`.
Auth failures surface as `EXTERNAL_API_ERROR` with `context.status` `401` (missing/invalid key) or `403`
(suspended org / missing scope) — terminal until the consumer fixes the key. The transient verification
`503` is retried automatically by the wire client (all calls, mutations included — the guard rejects
before the handler runs).

## Common call shapes

### Quote

```ts
const partnerFee = { address: '0xSonicFeeReceiver', percentage: 10 }; // 10 = 0.1% (bps)

const quote = await sodax.api.swaps.getQuote({
  tokenSrc, tokenSrcChainKey, tokenDst, tokenDstChainKey,
  amount: '1000000',          // smallest unit, decimal string
  quoteType: 'exact_input',
  partnerFee,
});
if (!quote.ok) return;
quote.value.quotedAmount;     // decimal string
// Pass query `{ includeTxData: true }` (and srcAddress/dstAddress on the body) to also get `txData`.
```

### Create intent

```ts
const created = await sodax.api.swaps.createIntent({
  srcChainKey, dstChainKey, inputToken, outputToken,
  inputAmount: '1000000',
  minOutputAmount: '990000',
  deadline: '0',              // "0" → no expiry (limit-order semantics)
  allowPartialFill: false,
  srcAddress, dstAddress,
  partnerFee,
});
if (!created.ok) return;
const { tx, intent, relayData } = created.value;
```

**Delivery hooks are deployment-dependent here.** `hook?: HookRequestV2` (`{ kind: HookKind }`) lives on
`SwapExtrasV2`, so it's structurally present on both `CreateIntentParamsV2` (`checkAllowance` /
`approve` / `createIntent` / `createLimitOrderIntent`) and `QuoteRequestV2` (`getQuote`), but only
`createIntent` / `createLimitOrderIntent` / `getQuote` with `includeTxData: true` actually consume it
— those are the only calls that build a delivery target. `checkAllowance` / `approve` inherit the
field but ignore it, same as `partnerFee` above: allowance-checking and approval are source-side only.
Unlike the SDK path, the hook is resolved **server-side**, so it only works when the backend forwards
the field *and* its pinned SDK has that kind registered for the request's destination chain —
`dstChainKey` everywhere except `getQuote`, which names it `tokenDstChainKey`; an unregistered kind
fails the request rather than falling back to a plain transfer. `dstAddress` still means the recipient the hook credits — the
backend substitutes the hook's own address on-chain. Whether the `getQuote` path forwards `hook` at all
is a backend question this SDK can't verify — confirm with the deployment before relying on it there.
The `deliveryData` payload encoding and the `supportedTokens` metadata-vs-enforcement distinction are
the full canonical contract on `SwapExtrasV2.hook`'s own doc comment in `@sodax/types`
(`backendApiV2.ts`) — read that before implementing server-side hook resolution.

When you need hook support independent of the deployment, build with `sodax.swaps` instead: it resolves
the hook client-side into `dstAddress`/`data`, and under the default `useBackendSubmitTx` still hands the
broadcast tx to this API's `submitTx`. See [`swap.md`](swap.md) § "Delivery hooks".

### Submit tx + poll status

```ts
// `intent` here is the IntentRequestV2 (bigint fields) you hold from createIntent.
const submit = await sodax.api.swaps.submitTx({
  txHash, srcChainKey, walletAddress, intent,
  relayData: relayData.payload,   // string — the payload, not the RelayExtraData object
});
if (!submit.ok) return;

// Both txHash AND srcChainKey are required by the status endpoint.
const status = await sodax.api.swaps.getSubmitTxStatus({ txHash, srcChainKey });
if (status.ok && status.value.data.status === 'solved') { /* settled */ }
// Lifecycle: 'pending' → 'relaying' → 'relayed' → 'posting_execution' → 'posted_execution' → 'solved' | 'failed'.
```

## Status fields — three distinct `status` values (don't conflate)

| Call | Field | Type | Values |
|---|---|---|---|
| `getStatus` | `StatusResponseV2.status` | **number** (`SwapIntentStatusCodeV2`) | `-1` NOT_FOUND · `1` NOT_STARTED_YET · `2` STARTED_NOT_FINISHED · `3` SOLVED (terminal) · `4` FAILED (terminal). `fillTxHash` is set only when `status === 3`. |
| `submitTx` | `SubmitTxResponseV2.data.status` | string | `'inserted'` (new) or `'duplicate'` (already submitted — submit-tx is idempotent on `(txHash, srcChainKey)`). |
| `getSubmitTxStatus` | `SubmitTxStatusResponseV2.data.status` | string | `'pending'` / `'relaying'` / `'relayed'` / `'posting_execution'` / `'posted_execution'` / `'solved'` / `'failed'` (`'solved'` / `'failed'` terminal). |

`getStatus` reports the **solver** intent status as a numeric code (`3` = `SOLVED`); the two submit-tx calls report **string** statuses (submission result vs relay-processing lifecycle, whose success terminal is the string `'solved'`). They are unrelated — don't treat one as the other; note the numeric solver `SOLVED` (`3`) is distinct from the submit-tx string `'solved'`.

## Per-call overrides

Every method accepts a trailing `RequestOverrideConfig` to redirect a single call to a different host or
attach request-specific headers (auth, tracing) or a per-call `apiKey`, overriding the service config:

```ts
// `baseURL` is the gateway ROOT — the SDK appends `/swaps/*` itself. Never include a service segment.
await sodax.api.swaps.getTokens({ baseURL: 'https://staging.example/v1', headers: { 'X-Trace': 'abc' } });
```

## Custom endpoint for the swaps API

`baseURL` is the gateway root, shared by every service; the swaps client appends `/swaps/*` below it just
as `sodax.backendApi` appends its own `/be` mount. Never put a service segment in `baseURL` — a value
ending in `/be` resolves swaps to `/v1/be/swaps/submit-tx`, which the gateway does not route (the SDK
trims that suffix, but do not rely on it).
To point the swaps API at its own host (separate from the base backend API), construct `Sodax` with the
**`CustomApiConfig`** variant of `ApiConfig` (`{ baseApiConfig?, swapsApiConfig? }`) instead of the flat
`BackendApiConfig`:

```ts
const sodax = new Sodax({
  api: {
    baseApiConfig: { baseURL: 'https://api.example/v1' },
    swapsApiConfig: { baseURL: 'https://swaps.example/v1' },
  },
});
```

The swaps slice layers over the base slice over the defaults (per field), so a cross-cutting header on
`baseApiConfig` (auth/tracing) still reaches swaps calls unless `swapsApiConfig` overrides that key. A flat
`BaseApiConfig` (the common case) is shared by both clients. See
[`backend-api.md`](backend-api.md) § "Custom backend" and [`../architecture.md`](../architecture.md).

## Error handling

```ts
const r = await sodax.api.swaps.getQuote(body);
if (!r.ok) {
  // r.error: SodaxError<'EXTERNAL_API_ERROR'> — feature: 'backend', context.api: 'swaps',
  // context.endpoint: '/swaps/quote'. The transport failure (HTTP_REQUEST_FAILED / REQUEST_TIMEOUT /
  // a shape-validation issue) is on r.error.cause.
  return;
}
```

## Cross-references

- `sodax.swaps` (the `SwapService` orchestrator that creates/executes intents end-to-end): [`swap.md`](swap.md). The swaps **API client** here is the lower-level HTTP surface; the orchestrator is the higher-level flow.
- `BackendApiService` (the sibling client for intent/orderbook/money-market reads): [`backend-api.md`](backend-api.md).
- Error model context fields: [`../reference/error-codes.md`](../reference/error-codes.md).
