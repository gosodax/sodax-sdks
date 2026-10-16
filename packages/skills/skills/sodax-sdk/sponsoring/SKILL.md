---
name: sodax-sdk-sponsoring
description: 'Granular skill for the @sodax/sdk v2 sponsoring feature — `sodax.sponsoring` (class SponsoringService), which activates a Stellar account by having the SODAX backend sponsor pay its XLM base reserve. A brand-new user holds 0 XLM and cannot create their own account; the client builds and signs the begin/create/end sandwich (the user''s signature authorises being sponsored) and the backend co-signs and submits. Use when the task involves activating or funding a new Stellar account, checking whether a Stellar account exists on-chain, or reading the sponsor build parameters (e.g. "activate a Stellar account", "sponsor a Stellar account", "user has no XLM", "account not found on Stellar", "sodax.sponsoring", "sponsored reserve", "base reserve", "createAccount for a new user"). For the raw HTTP endpoints use the `backend-api` skill; for the trustline step that follows activation see the Stellar notes in chain-specifics. Skill links into the parent sodax-sdk knowledge tree.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Sponsoring (Core SDK granular skill)

Granular skill for `sodax.sponsoring` (class `SponsoringService`) — Stellar account activation paid for
by the SODAX sponsor account.

A Stellar account must exist on-chain before it can hold or receive anything, and creating one costs an
XLM base reserve a brand-new user does not have. The sponsor pays it. The user's wallet still signs:
Stellar's sponsorship sandwich requires the *sponsored* account to authorise
`endSponsoringFutureReserves`, and only their wallet holds that key — so the client builds and signs,
and the backend validates, co-signs as sponsor, and submits.

Four methods, all returning `Result<T>` and never throwing: `activateStellarAccount`,
`isStellarAccountActive`, `getStellarAccountStatus`, `getStellarSponsorConfig`.

> **Activation makes the account able to RECEIVE, not to SEND.** The sponsor covers the account's own
> reserve and `startingBalance` is `0`, so a freshly activated account holds **zero spendable XLM** — it
> cannot pay a fee, and cannot cover the reserve its own first trustline would lock. The way out is
> native XLM, which needs no trustline: activate → receive XLM → then add trustlines. A non-native
> destination token therefore has TWO prerequisites, not one. See the Stellar section of
> [`../integration/knowledge/chain-specifics.md`](../integration/knowledge/chain-specifics.md).

## Step 1 — Clarify with user before coding

1. **Activation, or just a check?** Rendering an "Activate" button needs `isStellarAccountActive`;
   performing it needs `activateStellarAccount`. They handle a Horizon read failure *differently* on
   purpose — see the feature doc.
2. **Interactive or headless?** An interactive signer can be prompted a second time when the sponsor's
   sequence moves (the default). A headless caller should set `allowSequenceRetry: false` and own the
   backoff.
3. **Is the api key available?** The sponsoring service is `x-api-key` gated and runs on its own host,
   so it needs a `sponsoringApiConfig` slice. Confirm the key comes from an env var — never inlined.

## Integration workflow

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. [`../integration/knowledge/features/sponsoring.md`](../integration/knowledge/features/sponsoring.md) — the full surface: the two success shapes, the `nextAction` error table, the double-signature UX, analytics, gotchas, and config.
3. Errors are `Result<T, SodaxError>` → [`../integration/knowledge/recipes/result-and-errors.md`](../integration/knowledge/recipes/result-and-errors.md) and [`../integration/knowledge/reference/error-codes.md`](../integration/knowledge/reference/error-codes.md).
4. Needs a Stellar wallet provider → [`../integration/knowledge/reference/wallet-providers.md`](../integration/knowledge/reference/wallet-providers.md); for the raw endpoints behind it → [`../integration/knowledge/features/backend-api.md`](../integration/knowledge/features/backend-api.md).

### Sponsoring-specific anti-patterns

- **Treating `alreadyActive: true` as a failure.** It is a SUCCESS with `hash: null` — the account already existed and nothing was submitted. Both `status` values mean "the account is usable".
- **Hardcoding the sponsor public key.** Read it from `getStellarSponsorConfig()`. Hardcoding is what turns a sponsor rotation into a coordinated client release, and a stale value fails as a confusing `400` ("transaction source does not match sponsor account") that reads like an SDK bug.
- **Branching on `error.message` or on the HTTP status alone.** Branch on `error.context.nextAction`. Two different `503`s want opposite handling: `HORIZON_UNAVAILABLE` → re-submit the same bytes; `SPONSOR_BUDGET_EXHAUSTED` → contact an operator.
- **Assuming a body's `error` field is a domain code.** Framework exceptions put a human label there (`'Unauthorized'`, `'Bad Request'`), and two paths omit the field entirely — the per-IP throttler's `429` and the server's fallback for an unexpected error (a bare `500`). Membership-test against `SPONSORING_API_ERROR_CODES`, which is why it ships as a runtime array. `classifySponsorError` already does this.
- **Not surfacing the second signature.** On a sequence conflict the user is prompted again, and the wallet extension steals focus the instant it opens. Wire `onSignatureRequired` so the explanation is already on screen.
- **Broadcasting the signed XDR yourself.** It is missing the sponsor's signature until the server adds it — broadcasting burns the user's prompt on a guaranteed `tx_bad_auth`. Only `signTransaction` is used, never `sendTransaction`.
- **Rendering a failed `isStellarAccountActive` as "not active".** It returns `Result`, not a boolean — a transient Horizon blip must not be shown to the user as an inactive account.

## Migration workflow (v1 → v2)

The sponsoring feature is **v2-new** — v1 had no equivalent, and there is no v1 shape to port from. A
consumer arriving from v1 who previously told users to fund their own Stellar account can adopt it
additively. The general v2 conventions it relies on (`Result<T>`, `SodaxError`, chain-key-first
narrowing, wallet providers passed per call) are covered in:

1. [`../migration-v1-to-v2/knowledge/breaking-changes/result-and-errors.md`](../migration-v1-to-v2/knowledge/breaking-changes/result-and-errors.md) — the `Result` + `SodaxError` contract.
2. [`../migration-v1-to-v2/knowledge/features/backend-api.md`](../migration-v1-to-v2/knowledge/features/backend-api.md) — how backend clients hang off `sodax.api` in v2.

## Verification

1. `pnpm tsc --noEmit` clean.
2. Every `await sodax.sponsoring.<method>(...)` call site has `if (!result.ok)`.
3. Success handling distinguishes `status: 'submitted'` from `status: 'alreadyActive'`, and treats both as success.
4. Failure handling branches on `error.context.nextAction` — not on `message`, not on `status` alone.
5. The sponsor account is read from `getStellarSponsorConfig()` (or left to `activateStellarAccount`), never hardcoded.
6. `onSignatureRequired` is wired in any interactive UI.
7. The api key comes from an env var — not a literal. On the packaged SODAX gateway the instance-wide `new Sodax({ apiKey })` is inherited; for an independently hosted sponsoring service set `sponsoringApiConfig.apiKey` (or an `x-api-key` header), which wins.

## Related granular skills (same family)

- [`../backend-api/SKILL.md`](../backend-api/SKILL.md) — the raw `sodax.api.sponsoring` wire client and the sibling backend read client.

For multi-feature tasks, load the broad [`sodax-sdk` skill](../SKILL.md).
