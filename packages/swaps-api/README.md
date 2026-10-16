# @sodax/swaps-api

Minimal, type-safe HTTP client for the SODAX backend **Swaps API**.

- Implements the `ISwapsApiV2` contract from `@sodax/types` over `fetch`.
- Validates every response at runtime with [valibot](https://valibot.dev), and
  transforms each chain-specific unsigned `tx` back to its domain shape
  (decimal-string → `bigint`, Injective index-object bytes → `Uint8Array`).
- Zero dependency on `@sodax/sdk`, viem, or wallet providers — only
  `@sodax/types` (types) and `valibot`.

It is the single source of the swaps wire client: `@sodax/sdk`'s `SwapsApiService`
(`sodax.api.swaps`) is a thin adapter over this package, adding the SDK's
`Result<T>` contract, logger, and transport-config resolution on top. Use
`@sodax/swaps-api` directly when you want just the swaps backend without pulling in
the full SDK.

## Install

```bash
pnpm add @sodax/swaps-api
```

`valibot` is a regular dependency of this package, not a peer — installing it separately is unnecessary.

## Usage

```ts
import { SwapsApi, SwapsApiError } from '@sodax/swaps-api';

const api = new SwapsApi({ baseUrl: 'https://<swaps-api-host>' });

const tokens = await api.getTokens();
const quote = await api.getQuote({
  tokenSrc,
  tokenSrcChainKey,
  tokenDst,
  tokenDstChainKey,
  amount,
  quoteType: 'exact_input',
  partnerFee: { address: partnerReceiverOnSonic, percentage: 10 }, // 10 bps = 0.1%
});
```

`baseUrl` is required and injected by the caller — the package never hardcodes
environment URLs. Optionally set `timeout` (ms — an overall per-call deadline that
includes retries; on expiry the call throws `TIMEOUT_ERROR`), a custom `fetch` (for
tests or non-standard runtimes; it receives the timeout `AbortSignal`), extra `headers`,
and an `apiKey`.

## Methods

One method per Swaps API endpoint, mirroring `ISwapsApiV2`:

| Method | Endpoint |
|---|---|
| `getTokens()` | `GET /swaps/tokens` |
| `getTokensByChain(chainKey)` | `GET /swaps/tokens/:chainKey` |
| `getQuote(body, query?)` | `POST /swaps/quote` |
| `getDeadline(query?)` | `GET /swaps/deadline` |
| `checkAllowance(body)` | `POST /swaps/allowance/check` |
| `approve(body)` | `POST /swaps/approve` |
| `createIntent(body)` | `POST /swaps/intents` |
| `submitIntent(body)` | `POST /swaps/intents/submit` |
| `getStatus(body)` | `POST /swaps/intents/status` |
| `cancelIntent(body)` | `POST /swaps/intents/cancel` |
| `getIntentHash(body)` | `POST /swaps/intents/hash` |
| `getSolvedIntentPacket(body)` | `POST /swaps/intents/packet` |
| `getIntentSubmitTxExtraData(body)` | `POST /swaps/intents/extra-data` |
| `getFilledIntent(txHash)` | `GET /swaps/intents/:txHash/fill` |
| `getIntent(txHash)` | `GET /swaps/intents/:txHash` |
| `createLimitOrderIntent(body)` | `POST /swaps/limit-orders` |
| `estimateGas(body)` | `POST /swaps/gas/estimate` |
| `getPartnerFee(query)` | `GET /swaps/fees/partner` |
| `getSolverFee(query)` | `GET /swaps/fees/solver` |
| `submitTx(body)` | `POST /swaps/submit-tx` |
| `getSubmitTxStatus(query)` | `GET /swaps/submit-tx/status` |

`quoteType` is `'exact_input'` — exact-output quoting is not supported.

## API key

The backend guards `POST /swaps/*` routes with an `x-api-key` header check (keys are
minted through the partner portal). Pass the key once at construction and the client
sends it on every request:

```ts
// Server-side only — a key in a browser bundle is public
const api = new SwapsApi({ baseUrl: 'https://<swaps-api-host>', apiKey: process.env.SODAX_API_KEY });
```

An explicit `headers: { 'x-api-key': ... }` wins over the `apiKey` convenience option.
For a different key per call, construct another client — instances are cheap and
stateless. Keys bundled into a browser app are public by nature: from a browser, point
`baseUrl` at your own backend proxy and attach the key there — see [API key good practices](https://docs.sodax.com/developers/how-to/api-key-good-practices).

Auth failures surface as `HTTP_ERROR` with the backend's status and message on
`context`: `401` (missing or invalid key) and `403` (suspended organisation or missing
scope) are terminal — fix the key, don't retry. The one transient case, a `503` whose
message is `API key verification is temporarily unavailable` (exported as
`API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE`), is retried automatically with a short
backoff — for every call, mutations included, since the guard rejects before the route
handler runs.

## Partner fees

`partnerFee` has no default — this client forwards the body as given and does not read
`new Sodax({ fee })` / `new Sodax({ swaps: { partnerFee } })`. Send the same value on
quote and create-intent:

```ts
const partnerFee = { address: partnerReceiverOnSonic, percentage: 10 }; // 10 = 0.1%, 100 = 1%

const quote = await api.getQuote({ ...quoteBody, partnerFee });
const intent = await api.createIntent({ ...intentBody, partnerFee });
```

`checkAllowance` / `approve` inherit the field but ignore it. See
[MONETIZE_SDK.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/MONETIZE_SDK.md)
for the orchestrator path.

## Errors

Every method **throws** a `SwapsApiError` on failure — a single typed error whose
`code` is one of `NETWORK_ERROR` / `TIMEOUT_ERROR` / `HTTP_ERROR` / `PARSE_ERROR` /
`VALIDATION_ERROR`, with diagnostic `context` (endpoint, method, path, HTTP status,
validation issues) and the underlying failure on `.cause`. Idempotent calls (reads,
polls, pure-compute POSTs like `getQuote`) retry transient HTTP / network failures up to
3 attempts in total — the first try plus two retries, back to back with no delay; a
`timeout` and mutating calls are never retried — except the apiguard's verification
`503` (see "API key" above), which is replay-safe, retried for every call, and the one
retry that backs off. The budget is per call, so a caller that retries too (a React
Query hook, say) multiplies against it.

> Note: this throwing contract is intentional and distinct from `@sodax/sdk`'s
> `sodax.api.swaps`, which wraps these calls and returns `Result<T>` instead of throwing.

## Response schemas

The valibot schemas the client validates with are exported too, so a caller that already holds a
parsed response — or a sibling API whose wire shapes are identical — can reuse them instead of
re-declaring the contract. `@sodax/sdk`'s Leverage Yield client is exactly that case: a
leverage-yield deposit/withdraw **is** an intent-based swap, so it reuses these for its intent-relay,
gas, fee, and submit-tx responses.

- **Intent lifecycle:** `makeCreateIntentResponseSchema`, `makeCancelIntentResponseSchema`,
  `SubmitIntentResponseSchema`, `StatusResponseSchema`, `IntentHashResponseSchema`,
  `IntentPacketResponseSchema`, `IntentResponseSchema`, `RelayExtraDataResponseSchema`,
  `IntentStateSchema`
- **Quote · deadline · allowance · approve:** `makeQuoteResponseSchema`, `DeadlineResponseSchema`,
  `AllowanceCheckResponseSchema`, `makeApproveResponseSchema`
- **Gas · fees:** `GasEstimateResponseSchema`, `FeeResponseSchema`
- **Submit-tx state machine:** `SubmitTxResponseSchema`, `SubmitTxStatusResponseSchema`
- **Raw transactions:** `rawTxSchemaForChainKey(chainKey)` — the per-chain-family `tx` schema the
  `make*ResponseSchema` factories above take, which also transforms the unsigned tx back to its
  domain shape (decimal-string → `bigint`, Injective index-object bytes → `Uint8Array`)

```ts
import * as v from 'valibot';
import { makeApproveResponseSchema, rawTxSchemaForChainKey } from '@sodax/swaps-api';

const schema = makeApproveResponseSchema(rawTxSchemaForChainKey('sonic'));
const approve = v.parse(schema, await someOtherTransport('/approve'));
```

These are the response shapes only — request bodies are typed, not schema-validated.

## Reference app

[`apps/swap-api-example`](https://github.com/icon-project/sodax-sdks/tree/main/apps/swap-api-example)
drives this client end to end against a live Swaps API host.
