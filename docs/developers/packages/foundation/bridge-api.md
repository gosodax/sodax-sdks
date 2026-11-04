---
title: "@sodax/bridge-api"
icon: code
generatedFrom: packages/bridge-api/README.md
---

Minimal, type-safe HTTP client for the SODAX backend **Bridge API**.

- Implements the `IBridgeApiV2` contract from `@sodax/types` over `fetch`.
- Validates every response at runtime with [valibot](https://valibot.dev), and
  transforms each chain-specific unsigned `tx` back to its domain shape
  (decimal-string → `bigint`, Injective index-object bytes → `Uint8Array`).
- Zero dependency on `@sodax/sdk`, viem, or wallet providers — only
  `@sodax/types` (types) and `valibot`.

It is the single source of the bridge wire client: `@sodax/sdk`'s `BridgeApiService`
(`sodax.api.bridge`) is a thin adapter over this package, adding the SDK's
`Result<T>` contract, logger, and config resolution on top. Use `@sodax/bridge-api`
directly when you want just the bridge backend without pulling in the full SDK.

## Install

```bash
pnpm add @sodax/bridge-api valibot
```

## Usage

```ts
import { BridgeApi, BridgeApiError } from '@sodax/bridge-api';

const api = new BridgeApi({ baseUrl: 'https://<bridge-api-host>' });

const tokens = await api.getTokens();
const { tx, relayData } = await api.createBridgeIntent({
  srcChainKey,
  dstChainKey,
  inputToken,
  outputToken,
  inputAmount, // smallest unit, decimal string
  srcAddress,
  dstAddress,
});
// …sign + broadcast `tx`, then hand the FULL relay envelope back:
await api.submitTx({ txHash, srcChainKey, walletAddress, relayData });
```

`baseUrl` is required and injected by the caller — the package never hardcodes
environment URLs. Optionally set `timeout` (ms — an overall per-call deadline that
includes retries; on expiry the call throws `TIMEOUT_ERROR`), a custom `fetch` (for
tests or non-standard runtimes; it receives the timeout `AbortSignal`), extra `headers`, and an
`apiKey` (see below).

Bridge deltas vs the swaps client worth knowing:

- `createBridgeIntent` returns `{ tx, relayData }` — there is **no** `intent` struct
  (the bridge is vault-backed, not solver-based).
- `submitTx` must carry the **full** `relayData { address, payload }` envelope
  received from `createBridgeIntent`, not just the payload.
- `getSubmitTxStatus` `status` is a tolerant `string`; compare against the known
  terminal literals (`'executed'` / `'failed'`).
- `getFee` / `getBridgeableAmount` / `isBridgeable` are read-only quotes SDK consumers can get from
  the local `sodax.bridge.*` equivalents instead: `getFee` and `isBridgeable` compute locally, and
  `getBridgeableAmount` reads the hub vaults over RPC rather than calling the backend. These HTTP
  mirrors exist for non-SDK clients.

## API key

The backend guards the `/bridge/*` routes with an `x-api-key` header check (keys are
minted through the partner portal). Pass the key once at construction and the client
sends it on every request:

```ts
// Server-side only — a key in a browser bundle is public
const api = new BridgeApi({ baseUrl: 'https://<bridge-api-host>', apiKey: process.env.SODAX_API_KEY });
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

## Errors

Every method **throws** a `BridgeApiError` on failure — a single typed error whose
`code` is one of `NETWORK_ERROR` / `TIMEOUT_ERROR` / `HTTP_ERROR` / `PARSE_ERROR` /
`VALIDATION_ERROR`, with diagnostic `context` (endpoint, method, path, HTTP status,
validation issues) and the underlying failure on `.cause`. Idempotent calls (reads,
polls, pure-compute POSTs like `getFee`) retry transient HTTP / network failures up to
3 attempts in total — the first try plus two retries, back to back with no delay;
mutations are not, with one exception — the apiguard `503` above, which is replay-safe
and the one retry that backs off. A `timeout` is never retried: it bounds the whole
call, retries included. The budget is per call, so a caller that retries too (a React
Query hook, say) multiplies against it.

> Note: this throwing contract is intentional and distinct from `@sodax/sdk`'s
> `sodax.api.bridge`, which wraps these calls and returns `Result<T>` instead of throwing.
