# Swaps API — `SwapsApiService`

Typed HTTP client for the backend **Swaps API** (`/swaps/*`). Reached on the `Sodax` facade as
`sodax.api.swaps` — `sodax.api` is an alias for `sodax.backendApi`, and `.swaps` is the `SwapsApiService`
instance.

It mirrors `ISwapsApiV2` (from `@sodax/types`) one method per endpoint (21 total). Every method:

- returns `Promise<Result<T>>` — it **never throws**;
- validates the JSON response at runtime against a valibot schema (a contract drift is surfaced as
  `{ ok: false }`, not returned untyped);
- accepts an optional trailing `RequestOverrideConfig` (`{ baseURL?, timeout?, headers?, apiKey? }`)
  for per-call overrides — the same shared type every other backend client takes.

> This is the lower-level backend HTTP surface. For the end-to-end create→relay→post-execution swap
> orchestrator, use `sodax.swaps` (see [`SWAPS.md`](SWAPS.md)).

## Methods

```typescript
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

// Intent lifecycle
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

## `partnerFee`

Optional on the type, but there is no default — the client forwards the body as given and never
reads `new Sodax({ fee })` / `new Sodax({ swaps: { partnerFee } })`. Send the same value on quote
and create-intent:

```typescript
const partnerFee = { address: '0xYourSonicFeeReceiver', percentage: 10 }; // 10 = 0.1% (bps)

await sodax.api.swaps.getQuote({ ...quoteBody, partnerFee });
await sodax.api.swaps.createIntent({ ...intentBody, partnerFee });
```

`checkAllowance` / `approve` inherit the field but ignore it. See [MONETIZE_SDK.md](MONETIZE_SDK.md)
for the orchestrator path and fee claiming.

## Delivery hooks

`hook?: HookRequestV2` (`{ kind: HookKind }`) lives on `SwapExtrasV2`, so it's structurally present on
every method whose body extends it: `getQuote`, `checkAllowance`, `approve`, `createIntent`, and
`createLimitOrderIntent` (`CreateLimitOrderParamsV2` is `CreateIntentParamsV2` minus `deadline`, so it
carries `hook` too). Only the endpoints that actually build a delivery target *consume* it, though —
`createIntent`, `createLimitOrderIntent`, and `getQuote` with `includeTxData: true`. Setting it there
routes the intent's output through a registered delivery hook instead of a plain transfer to
`dstAddress` — the backend resolves the hook's deployed address and encodes its payload, so
`dstAddress` keeps meaning "the recipient the hook credits," not the delivery target.

```typescript
import { HookKind } from '@sodax/sdk';

const created = await sodax.api.swaps.createIntent({
  ...intentBody,
  hook: { kind: HookKind.HYPERCORE_DEPOSIT },
});
```

- **`checkAllowance` / `approve` inherit the field but ignore it**, same as `partnerFee` above:
  allowance-checking and approval are source-side only and never touch `dstAddress`, so there's
  nothing for a hook to apply to.
- **Server-side, deployment-dependent.** Unlike `sodax.swaps` (which resolves a hook client-side),
  here the hook is resolved by the backend. It only works when the backend forwards the field *and*
  its pinned SDK has that kind registered for the request's destination chain — `dstChainKey` on
  every body above except `getQuote`, which names it `tokenDstChainKey` instead. An unregistered kind
  fails the request rather than silently falling back to a plain transfer.
- **On `getQuote`, only meaningful with `includeTxData: true`** — a bare quote never builds an
  intent, so there's nowhere for a hook to apply, mirroring how `srcPublicKey`/`bound` already work
  on this endpoint. Whether a given backend forwards `hook` through that path at all is a deployment
  question this SDK cannot verify from here.
- **Full contract lives on the type.** The `deliveryData` payload's per-`HookKind` ABI shape and the
  `supportedTokens` metadata-vs-enforcement distinction aren't repeated here — see the `hook` field's
  own doc comment on `SwapExtrasV2` in `@sodax/types` (`backendApiV2.ts`) for the complete, canonical
  spec a backend integration should implement against.

## `approve` can return two transactions

`ApproveResponseV2` is `{ tx, resetTx? }`. `resetTx` is present only when the source token rejects an
allowance change from one non-zero value to another — the 2017 TetherToken lineage, of which
Ethereum USDT is the one in the SODAX token list today — and the wallet already holds a stale
allowance. A wallet in that state cannot approve at all until the allowance is zeroed.

When `resetTx` is present, broadcast it **first** and wait for it to be mined, then broadcast `tx`.
The second approval is only valid once the reset has landed on-chain, so the two cannot be batched.

```typescript
const { tx, resetTx } = approveResponse;

if (resetTx) {
  const resetHash = await sendTransaction(resetTx);
  await waitForTransactionReceipt(resetHash);
}

const approveHash = await sendTransaction(tx);
await waitForTransactionReceipt(approveHash);
```

The field is optional and absent for every other token, so a client that ignores it keeps working
exactly as before — it just cannot rescue a wallet stuck on a guarded token.

**In a React app, don't hand-roll the sequence.** `@sodax/dapp-kit` ships
`useSwapsApiApproveAndBroadcast`, which requests, signs, broadcasts and waits for both transactions
and resolves with `{ approveTxHash, resetTxHash? }` only once the approval has landed — the ordering
above lives in the package rather than in every integration.

## Wire shapes — `bigint` vs decimal strings

Request bodies that carry an `intent` struct (`cancelIntent`, `getIntentHash`,
`getIntentSubmitTxExtraData`, `submitTx`) take `IntentRequestV2`, whose numeric fields (`intentId`,
`inputAmount`, `minOutputAmount`, `deadline`, `srcChain`, `dstChain`) are **`bigint`**; the client
serializes them to decimal strings on the wire. Server-returned intents (`IntentResponseV2`) come back
with those fields as decimal **`string`**. The `amount` / `inputAmount` fields on the quote /
create-intent bodies are already decimal strings.

> **Never pass `bigint` to `JSON.stringify`** in your own code — it throws. The client uses a bigint-safe
> serializer internally; pass the `IntentRequestV2` through unmodified.

## Long-polling — `getSolvedIntentPacket`

`getSolvedIntentPacket` is a **server-side long-poll**: it issues a single request that the backend holds
open until the fill packet lands on the destination chain (or `body.timeout` ms elapses, default ~60s).
Call it once and `await` the result — do **not** poll it client-side in a loop. Every other read
(`getStatus`, `getSubmitTxStatus`, …) is an ordinary point-in-time read that you poll yourself.

## Examples

```typescript
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax();

// Quote
const quote = await sodax.api.swaps.getQuote({
  tokenSrc, tokenSrcChainKey, tokenDst, tokenDstChainKey,
  amount: '1000000',
  quoteType: 'exact_input',
  partnerFee,
});
if (!quote.ok) return;
quote.value.quotedAmount; // decimal string

// Create intent → submit tx → poll status
const created = await sodax.api.swaps.createIntent({
  srcChainKey, dstChainKey, inputToken, outputToken,
  inputAmount: '1000000', minOutputAmount: '990000', deadline: '0',
  allowPartialFill: false, srcAddress, dstAddress,
  partnerFee,
});
if (!created.ok) return;
const { tx, intent, relayData } = created.value;

const submit = await sodax.api.swaps.submitTx({
  txHash, srcChainKey, walletAddress, intent,
  relayData: relayData.payload, // string payload, not the RelayExtraData object
});
if (!submit.ok) return;

// Both txHash AND srcChainKey are required.
const status = await sodax.api.swaps.getSubmitTxStatus({ txHash, srcChainKey });
if (status.ok && status.value.data.status === 'solved') { /* settled */ }
// Lifecycle: 'pending' → 'relaying' → 'relayed' → 'posting_execution' → 'posted_execution' → 'solved' | 'failed'.
```

## Status fields — three distinct `status` values

These are unrelated; don't treat one as another:

| Call | Field | Type | Values |
|---|---|---|---|
| `getStatus` | `StatusResponseV2.status` | **number** (`SwapIntentStatusCodeV2`) | `-1` NOT_FOUND · `1` NOT_STARTED_YET · `2` STARTED_NOT_FINISHED · `3` SOLVED (terminal) · `4` FAILED (terminal). `fillTxHash` set only when `status === 3`. |
| `submitTx` | `SubmitTxResponseV2.data.status` | string | `'inserted'` (new) or `'duplicate'` (already submitted — idempotent on `(txHash, srcChainKey)`). |
| `getSubmitTxStatus` | `SubmitTxStatusResponseV2.data.status` | string | `'pending'` / `'relaying'` / `'relayed'` / `'posting_execution'` / `'posted_execution'` / `'solved'` / `'failed'` (`'solved'` / `'failed'` terminal). |

This record tracks the backend submit path only. It answers **404** when no record exists
(`useBackendSubmitTx: false`, or the submit never landed), and returns a **stale or abandoned** record for a
swap `sodax.swaps.swap()` finished via its client-side relay fallback — that path submits first and falls
back afterwards, so the record survives without reflecting the outcome. To cover every case from a source tx
hash, use `sodax.swaps.getDetailedStatus` —
[SWAPS.md § Get Detailed Status](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md).

## Configuration

`sodax.api.swaps` shares the backend API config. `baseURL` is the **gateway root** — the same value every
service resolves — and the swaps client appends `/swaps/*` below it, exactly as `sodax.backendApi` appends
its own `/be` mount. So a `baseURL` must never carry a service segment: a value ending in `/be` (the
previous packaged default) would put swaps at `/v1/be/swaps/submit-tx`, which the gateway does not route.
The SDK trims that suffix — with a deprecation warning when it appears on the flat field or the
`baseApiConfig` slice, silently on a `swapsApiConfig` slice (that combination never worked, so there is
nothing to deprecate). For the `ApiConfig` type itself — including the `basePath` knob on the flat
variant — see
[BACKEND_API.md § `ApiConfig` Type](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/BACKEND_API.md).

```typescript
const sodax = new Sodax({
  api: {
    baseApiConfig: { baseURL: 'https://api.example/v1' },
    swapsApiConfig: { baseURL: 'https://swaps.example/v1' },
  },
});
```

The swaps slice layers over the base slice over the defaults (per field) — a cross-cutting header on
`baseApiConfig` (auth/tracing) still reaches swaps calls unless `swapsApiConfig` overrides that key.

### API key

The backend guards `POST /swaps/*` routes with an `x-api-key` header check. Configure the key once —
`new Sodax({ apiKey })`, the same instance-wide key every backend client uses — and every
`sodax.api.swaps` call carries it; override it per call via the trailing `RequestOverrideConfig`:

```typescript
// Server-side only — a key in a browser bundle is public
await sodax.api.swaps.createIntent(params, { apiKey: 'per-request-key' });
```

Auth failures surface as `EXTERNAL_API_ERROR` with `context.status` `401` (missing/invalid key) or `403`
(suspended organisation / missing scope) — terminal config problems — while the transient verification
`503` is retried by the wire client. See
[CONFIGURE_SDK.md § API key](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md#api-key)
for the full precedence order, and [API key good practices](https://docs.sodax.com/developers/how-to/api-key-good-practices) for keeping the key off the client.

## Result\<T\> and Error Handling

Every method returns `Result<T, SodaxError<'EXTERNAL_API_ERROR'>>`. On any failure (network, timeout,
non-2xx HTTP, or response-shape mismatch), the result is `{ ok: false }` with a `SodaxError` carrying
`feature: 'backend'`, `context.api: 'swaps'`, and `context.endpoint` (the path); the underlying failure
is preserved on `error.cause`.

```typescript
const r = await sodax.api.swaps.getQuote(body);
if (!r.ok) {
  // r.error.feature === 'backend'; r.error.context.endpoint === '/swaps/quote'
  // r.error.context.code / (r.error.cause as SwapsApiError).code:
  //   NETWORK_ERROR | TIMEOUT_ERROR | HTTP_ERROR | PARSE_ERROR | VALIDATION_ERROR
  return;
}
```

### Implementation note

`SwapsApiService` is a thin adapter over the standalone [`@sodax/swaps-api`](../../swaps-api/README.md)
package — the single source of the swaps wire client (request building, per-chain `tx`
validation/transform, response schemas, HTTP). This service adds the SDK conventions on top: the
`Result<T>` contract, the `SodaxLogger`, `ApiConfig`/`CustomApiConfig` resolution, and per-call
`RequestOverrideConfig`. Two consequences worth noting:

- **`error.cause` is a `SwapsApiError`** (from `@sodax/swaps-api`), not the raw transport error — read
  its `code` (`NETWORK_ERROR` | `TIMEOUT_ERROR` | `HTTP_ERROR` | `PARSE_ERROR` | `VALIDATION_ERROR`) to
  distinguish failure kinds; the same code is mirrored onto `error.context.code`. Both `SwapsApiError`
  and the `SwapsApiErrorCode` union are re-exported from `@sodax/sdk`, so you can narrow `error.cause`
  and type `error.context.code` without a direct `@sodax/swaps-api` import.
- **Idempotent calls retry transient failures.** Reads, polls, and pure-compute POSTs (e.g. `getQuote`)
  are retried a few times on transient statuses / network errors; mutating calls are never retried —
  except the apiguard's transient key-verification `503`, which is rejected before the route handler
  runs and is therefore replayed (with a short backoff) for every call.

## See also

- [`BACKEND_API.md`](BACKEND_API.md) — `sodax.backendApi`, the sibling client for intent/orderbook/money-market reads + config.
- [`SWAPS.md`](SWAPS.md) — `sodax.swaps` (`SwapService`), the end-to-end intent orchestrator.
