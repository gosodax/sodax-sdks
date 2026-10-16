# Sponsoring — `SponsoringService`

Reachable as `sodax.sponsoring`. Activates a Stellar account by having the SODAX sponsor pay its
XLM base reserve.

## Why this exists

A Stellar account must exist on-chain before it can hold or receive anything, and a brand-new SODAX
user holds 0 XLM — a chicken-and-egg problem. Stellar solves it with *sponsored reserves*: a sponsor
account pays the reserve inside a `beginSponsoringFutureReserves` → `createAccount` →
`endSponsoringFutureReserves` operation sandwich.

**The user's own wallet must sign.** Their signature is what authorises `endSponsoringFutureReserves`,
and only their wallet holds that key — so this can never be a server-only call. The client builds and
signs; the backend validates, co-signs as the sponsor, and submits.

The build rules are enforced strictly server-side and every violation is a `400`, which is why they
live in one tested place in the SDK rather than being copy-pasted per consumer. It also means the
sponsor account can be rotated without a client release.

## Surface

```ts
// @ai-snippets-skip
sodax.sponsoring.isStellarAccountActive({ address });        // Result<boolean>
sodax.sponsoring.getStellarAccountStatus({ address });       // Result<StellarAccountStatus>
// { exists, nativeBalanceStroops, availableBalanceStroops, canAffordTrustline, trustlineMinXlmStroops }
sodax.sponsoring.getStellarSponsorConfig({ forceRefresh? }); // Result<StellarSponsorConfig>
sodax.sponsoring.activateStellarAccount({
  address,                  // must be the account walletProvider signs with
  walletProvider,           // IStellarWalletProvider — only signTransaction is used
  allowSequenceRetry?,      // default true; one rebuild + re-sign on a sequence conflict
  maxHorizonRetries?,       // default 2; no-prompt re-submits of the SAME payload on a 503
  onSignatureRequired?,     // fires immediately BEFORE each wallet prompt
  forceConfigRefresh?,
  requestConfig?,
});
```

The raw endpoints stay available as `sodax.api.sponsoring` (`getStellarSponsorConfig`,
`createStellarSponsoredAccount`) for integrators who build their own XDR.

## Two success shapes — both are `ok`

```ts
// @ai-snippets-skip
type ActivateStellarAccountResult =
  | { status: 'submitted';    hash: string; attempts: 1 | 2 }
  | { status: 'alreadyActive'; hash: null;  attempts: 0 | 1 | 2 };
```

`alreadyActive` means the account already existed and nothing was submitted — the account is usable,
so render it as success, not as a no-op failure. `attempts: 0` means the client-side pre-flight
caught it and the user was never prompted at all.

## Errors — branch on `context.nextAction`, not the HTTP status

Failures carry the caller's next action on `error.context`, alongside `retryable` and
`requiresNewSignature`:

| `nextAction` | Meaning |
|---|---|
| `fixIntegration` | The request was malformed. An SDK/caller bug; never retry as-is. |
| `checkApiKey` | Missing or invalid api key. A deployment problem. |
| `rebuildAndResign` | The sponsor's sequence moved. Costs a **new user signature**. |
| `retrySameRequest` | Transient upstream failure; the signed payload is still valid. |
| `backoff` | Quota, throttle, draining coordinator, or a transport failure. |
| `contactOperator` | Sponsor out of budget, or a server fault. Not caller-fixable. |
| `abort` | Deterministic on-chain rejection. Terminal. |

On a per-key quota 429 the error also carries `context.retryAfterSeconds` — seconds until the breached
window rolls over, floored at 1. Prefer it over a fixed backoff. It comes from the response body rather
than the `Retry-After` header, because a body needs no CORS opt-in and so survives a browser; note the
`X-RateLimit-*` headers describe the **per-IP** throttle, not this per-key quota.

The SDK does not auto-retry a 429 — it is a load signal for the caller to pace. Only
`HORIZON_UNAVAILABLE` gets a silent same-payload retry.

`classifySponsorError(error)` is exported if you need the same classification for a raw
`sodax.api.sponsoring` call.

**`retryable` is broader than what the SDK auto-retries.** It is `true` for 409, 429, a draining 503
and every transport failure — but the SDK only ever re-sends on `nextAction: 'retrySameRequest'`.
Branch on `nextAction`, not `retryable`, if you are deciding whether to re-send.

## Analytics

With `analytics` enabled the flow emits one `start` and one terminal event under
`feature: 'sponsoring'`, `action: 'activateStellarAccount'`. Both terminals carry `attempts`
(`0 | 1 | 2`): `0` means the pre-flight short-circuited or the flow failed before any attempt, and
`2` is reachable only through the sequence-conflict retry — so `attempts: 2` means a 409 occurred,
whatever the final outcome was. Success adds `status` (`'submitted' | 'alreadyActive'`) and `hash`;
failure adds `code`, `httpStatus` and `nextAction`. The HTTP status is deliberately NOT called
`status`, so the property does not change type between the two events.

## Gotchas

- **Activation makes the account able to RECEIVE, not to SEND.** The sponsor covers the account's own
  base reserve and `startingBalance` is `0` by contract, so a freshly activated account holds **zero
  spendable XLM** — the reserve sits locked on the sponsor's balance, not in the user's account. It
  cannot pay a transaction fee, and cannot cover the additional base reserve a new subentry locks, so
  it **cannot establish its own first trustline**. The escape is native XLM, which needs no trustline:
  activate → receive XLM → then add trustlines. A non-native destination token therefore has TWO
  prerequisites, not one. Read `canAffordTrustline` from `getStellarAccountStatus` rather than
  inferring capability from `isStellarAccountActive` — and note it is measured against
  `availableBalanceStroops`, not the total, because Stellar locks one base reserve per existing
  subentry. Render `status.trustlineMinXlmStroops` when telling a user how much to send: the base
  reserve is a network setting validators can change, so the SDK reads it from Horizon (cached hourly)
  and `STELLAR_TRUSTLINE_MIN_XLM_STROOPS` is only the fallback for a failed read. Sponsored trustlines
  and fee sponsorship would remove the middle step; neither exists yet.
- **A sequence conflict costs a second wallet prompt.** The sponsor's sequence number is baked into
  the signed payload, so a conflict forces a rebuild and re-sign. The SDK retries **exactly once**
  and never loops. Wire `onSignatureRequired` and show the explanation *before* the wallet steals
  focus — it fires immediately before each prompt. The server attaches the current sponsor sequence
  to a genuine 409 (`context.sponsorSequence`), so the rebuild skips a Horizon read; it is advisory,
  so the SDK falls back to reading Horizon when it is absent.
- **Never hardcode the sponsor account.** It is published by the config endpoint and cached briefly;
  that indirection is what makes rotation a config change.
- **Never broadcast the signed transaction yourself.** It is missing the sponsor's signature until
  the server adds it, so `sendTransaction` / `signAndSendTransaction` would burn the user's prompt on
  a guaranteed `tx_bad_auth`. Only `signTransaction` is used.
- **Name the signer.** The transaction is sourced by the *sponsor* but must be signed by the account
  being created, so the SDK calls `signTransaction(xdr, { address })`. If you build your own XDR,
  pass `address` too — omit it and a browser wallet signs with whatever account is currently active,
  returning a well-formed envelope with the wrong signature that the server rejects as unsigned.
  (A signer that is not the transaction source is ordinary Stellar — it is how multisig and every
  sponsorship flow work; no wallet refuses it.)
- **Public network only.** The service rejects a testnet Horizon by design — there is no testnet
  path. A wallet connected to testnet signs over the wrong network id and returns a well-formed
  envelope, so the SDK verifies the signature locally and fails with `VALIDATION_FAILED` rather than
  letting the server report an opaque `400`.
- **Fee is per-operation; the published totals are a TOTAL.** If you build your own XDR, pass
  `recommendedPerOperationFeeStroops` from the config endpoint verbatim — do not divide the totals,
  and never pass a `BASE_FEE`-style default (100/op → 300 total → rejected against the 3000 floor).
  `operationCount` is published so you can cross-check rather than baking "3 ops" into your own
  contract. The config endpoint always publishes the per-operation band — deriving it from the totals
  would need ceiling division, which is exactly what publishing it removes. The SDK handles all of
  this.

## Config

```ts
// @ai-snippets-skip
new Sodax({ api: { sponsoringApiConfig: { baseURL, timeout, headers, apiKey } } });
```

`baseURL` defaults to the packaged sponsoring endpoint (`DEFAULT_SPONSORING_API_ENDPOINT`,
`https://api.sodax.com/v1`) and does **not** inherit `baseApiConfig` — the service is routed
independently. Give it the base URL **including any version or gateway prefix**: the SDK appends only
`SPONSORING_API_STELLAR_BASE_PATH` (`/sponsorships/stellar`), so a locally-run service that mounts the
routes at its bare origin is reached with `baseURL: 'http://localhost:3011'`.

`apiKey` is folded into `x-api-key`. An api key in a browser bundle is public by nature: the service's
per-key quotas, fleet-wide daily cap, per-IP throttle, and origin gating are the real controls. Proxy
through your own backend if that is not acceptable: https://docs.sodax.com/developers/how-to/api-key-good-practices.

The instance-wide `new Sodax({ apiKey })` is **gated** here, unlike every other backend service: it is
inherited only when the call targets a SODAX gateway (the packaged sponsoring default or the resolved
shared root), and the check runs per request against the effective target, so a per-call `baseURL`
override cannot carry it off-gateway. A custom sponsoring origin never receives it. The slice `apiKey`
above is the credential for independently hosted sponsoring and wins wherever the slice points.
Sponsoring keys come from their own registry (issued by the SODAX team, not the partner portal), so a
portal key that reaches sponsoring through inheritance is rejected — always set the slice `apiKey`.

## Cross-references

- React hooks wrapping this service — `useStellarAccountActive`, `useSponsorConfig`,
  `useActivateStellarAccount` — are documented in the `sodax-dapp-kit` skill under its
  auxiliary-services feature doc.
- Service is new in v2 — there is no v1 equivalent and nothing to port.
