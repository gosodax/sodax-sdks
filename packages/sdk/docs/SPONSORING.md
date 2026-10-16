# Sponsoring — `SponsoringService`

Stellar account activation paid for by the SODAX sponsor account. Reached on the `Sodax` facade as
`sodax.sponsoring`.

A brand-new SODAX user holds 0 XLM, and a Stellar account must exist on-chain before it can hold or
receive anything — including a trustline. This service drives the sponsored-reserve flow that fixes
that: the sponsor pays the account's base reserve, and the user pays nothing.

The user's wallet still has to sign. Stellar's sponsorship sandwich requires the *sponsored* account
to authorise `endSponsoringFutureReserves`, and only the user's wallet holds that key — so the client
builds and signs, and the backend validates, co-signs as the sponsor, and submits. The sponsor's
signature is added server-side; never attempt it client-side.

## What activation does and does not unlock

Read this before building a flow on top of activation — the boundary is easy to get wrong, and the
mistake is only visible at the point a user's transaction fails.

Activation makes the account able to **receive**. It does not make it able to **send**. The sponsor
covers the account's own base reserve, and `startingBalance` is `0` by contract, so a freshly activated
account holds **zero spendable XLM** — the reserve is locked on the *sponsor's* balance, not sitting in
the user's account. With no XLM it cannot pay a transaction fee, and it cannot cover the extra base
reserve a new subentry locks. So it cannot establish its own first trustline.

The way out is native XLM, which needs no trustline:

1. **Activate** — free to the user. The account now exists and can receive.
2. **Receive XLM** — no trustline, no fee on the recipient's side. This is what makes the account
   able to act.
3. **Add trustlines** for other assets — now affordable, since the account holds XLM.

So a destination token that is *not* native XLM has two prerequisites, not one. `@sodax/dapp-kit`'s
`useStellarGate` sequences all three states for you; prefer it over calling
`isStellarAccountActive` and a trustline check side by side. `getStellarAccountStatus` is the
underlying read — it reports `canAffordTrustline`, which is `false` for exactly this
freshly-activated case.

Note that affordability is measured against `availableBalanceStroops`, not the total balance. Stellar
locks one base reserve per subentry, so an account holding 0.6 XLM with one existing trustline has only
0.1 XLM spendable and cannot afford a second — the total would say otherwise.

The base reserve itself is a network setting validators can vote to change, not a protocol constant, so
the SDK reads it from the latest Horizon ledger (cached for an hour) instead of assuming 0.5 XLM.
`status.trustlineMinXlmStroops` is that live requirement — render it rather than the exported
`STELLAR_TRUSTLINE_MIN_XLM_STROOPS`, which is only the value assumed when the ledger read fails.

Sponsored trustlines and fee sponsorship would remove step 2; neither exists yet.

> See also [`STELLAR_TRUSTLINE.md`](STELLAR_TRUSTLINE.md) for the trustline step itself.

## Methods

```ts
sodax.sponsoring.activateStellarAccount(params: ActivateStellarAccountParams)
  : Promise<Result<ActivateStellarAccountResult, SponsoringOrchestrationError>>

sodax.sponsoring.isStellarAccountActive(params: { address: string })
  : Promise<Result<boolean, SponsoringLookupError>>

sodax.sponsoring.getStellarAccountStatus(params: { address: string })
  : Promise<Result<StellarAccountStatus, SponsoringLookupError>>
  // { exists, nativeBalanceStroops, availableBalanceStroops, canAffordTrustline, trustlineMinXlmStroops }
  // One Horizon account read, plus an hourly read of the network's base reserve.

sodax.sponsoring.getStellarSponsorConfig(params?: { forceRefresh?: boolean; requestConfig?: RequestOverrideConfig })
  : Promise<Result<StellarSponsorConfig, SponsoringConfigError>>
```

Every method returns `Result<T>` and never throws. The raw HTTP endpoints remain available as
`sodax.api.sponsoring` (see [`BACKEND_API.md`](BACKEND_API.md)) — use `sodax.sponsoring` unless you
need the uncached wire surface, because the orchestrator owns the sponsor-config cache, the Horizon
reads, and the retry policy.

## Activating an account

```ts
import { ChainKeys } from '@sodax/sdk';

const result = await sodax.sponsoring.activateStellarAccount({
  address: stellarAddress,
  walletProvider: stellarWalletProvider,
  onSignatureRequired: ({ attempt, reason }) => {
    setPrompt(reason === 'sequenceConflict'
      ? 'Your first signature went stale — please sign again.'
      : 'Approve the activation in your wallet.');
  },
});

if (!result.ok) {
  // See "Handling failures" below — branch on result.error.context.nextAction.
  return;
}

if (result.value.status === 'alreadyActive') {
  // Success. The account already existed on-chain, so nothing was submitted.
} else {
  console.log('activated in tx', result.value.hash);
}
```

### `alreadyActive` is a success

This is the single easiest thing to get wrong. `activateStellarAccount` has two success shapes:

| `status` | `hash` | `attempts` | Meaning |
| --- | --- | --- | --- |
| `'submitted'` | the tx hash | `1` or `2` | A sponsored-create was submitted and landed. |
| `'alreadyActive'` | `null` | `0`, `1` or `2` | The account already existed. **Nothing was submitted, and this is still a success** — the account is usable. |

`attempts: 0` means the client-side pre-flight caught it and the user was never prompted at all. A
non-zero value means the server reported it (either from its own pre-flight or from an
`op_already_exists` race), so the prompt had already been paid for.

Because the result type is a discriminated union on `status`, `if (result.value.status === 'submitted')`
narrows `hash` to `string` with no non-null assertion.

### The second signature

A sponsor has one sequence number, and every integrator's activation moves it. When it moves under an
in-flight activation the server returns `409`, and the only fix is to rebuild from a fresh sequence
and **sign again**. `activateStellarAccount` does that automatically once (`allowSequenceRetry`,
default `true`).

That second prompt is a UX event, not an implementation detail: a wallet extension steals focus the
moment it opens, so the explanation has to already be on screen. Wire `onSignatureRequired` — it fires
immediately *before* each prompt with `{ attempt: 1 | 2, reason: 'initial' | 'sequenceConflict' }`.

Set `allowSequenceRetry: false` for headless callers with no interactive signer, or to own the backoff
yourself. The retry is exactly one attempt, never a loop.

A transient upstream failure (`503 HORIZON_UNAVAILABLE`) is different: the signed envelope stays valid
until its `maxTime` and its sequence can be consumed only once, so the *identical bytes* are
re-submitted with no new prompt. `maxHorizonRetries` (default `2`, `0` disables) bounds that.

## Handling failures

Branch on `error.context.nextAction`, never on `error.message`. The HTTP status alone is not enough —
the two `503` variants want opposite responses.

| `nextAction` | `retryable` | `requiresNewSignature` | Typical cause | What to do |
| --- | --- | --- | --- | --- |
| `fixIntegration` | ✗ | ✗ | `400 INVALID_SPONSOR_XDR`, or a rejected body shape | An SDK/caller bug. Never retry as-is. |
| `checkApiKey` | ✗ | ✗ | `401` — missing or unknown `x-api-key` | Deployment problem; fail fast. |
| `rebuildAndResign` | ✓ | ✓ | `409 SPONSOR_SEQUENCE_CONFLICT` | Rebuild from a fresh sequence. Costs a new signature — handled for you unless `allowSequenceRetry: false`. |
| `retrySameRequest` | ✓ | ✗ | `503 HORIZON_UNAVAILABLE` | Re-submit the identical payload. No new signature. |
| `backoff` | ✓ | ✗ | `429` (either flavour), a draining coordinator, or any transport failure/timeout | Wait, then retry. Honour `retryAfterSeconds` when present. |
| `contactOperator` | ✗ | ✗ | `503 SPONSOR_BUDGET_EXHAUSTED`, `500` | The sponsor needs a top-up, or the server faulted. Not fixable by retrying soon. |
| `abort` | ✗ | ✗ | `422 SPONSOR_TRANSACTION_REJECTED` | Deterministic on-chain rejection. Terminal. |

The classification is also available directly via `classifySponsorError(error)` if you are calling
`sodax.api.sponsoring` yourself:

```ts
import { classifySponsorError } from '@sodax/sdk';

const submitted = await sodax.api.sponsoring.createStellarSponsoredAccount({ data: signedXdr });
if (!submitted.ok) {
  const { action, retryable, retryAfterSeconds } = classifySponsorError(submitted.error);
}
```

Useful `error.context` fields on an activation failure: `nextAction`, `retryable`,
`requiresNewSignature`, `status` (HTTP status, absent for transport failures), `code` (one of the
seven `SponsoringApiErrorCode`s, present only when the body carried a recognised code),
`retryAfterSeconds`, `sponsorSequence`, `sponsorAccount`, and `attempts`.

Note that a body's `error` field is **not** always a domain code — framework exceptions put a human
label there (`'Unauthorized'`, `'Bad Request'`), and two paths omit it entirely: the per-IP
throttler's `429`, and the server's fallback for an unexpected error (a bare `500`).
That is why `SPONSORING_API_ERROR_CODES` ships as a runtime array: membership-test before treating
`error` as a code. `classifySponsorError` already does this.

## Checking whether an account is active

```ts
const active = await sodax.sponsoring.isStellarAccountActive({ address });
if (!active.ok) {
  // A Horizon read failure — do NOT render this as "not active".
} else if (!active.value) {
  showActivateButton();
}
```

This surfaces a read failure as an error rather than reporting `false`, on purpose: rendering a
transient Horizon blip as "your account is not active" is the failure mode worth avoiding when the
answer drives UI.

The pre-flight *inside* `activateStellarAccount` does the opposite and degrades to "assume not
active" on a read failure. There it is purely an optimisation — it saves a doomed wallet prompt — so a
blip must not fail an activation that would otherwise succeed. The server runs its own pre-flight and
converts a post-submit `op_already_exists` into `alreadyActive: true`, so the outcome stays correct
either way; the only cost is one wasted prompt.

## Sponsor config

`getStellarSponsorConfig()` returns the service's published build parameters — `sponsorAccount`,
`networkPassphrase`, the fee band, `maxTimeboundSeconds`, `requiredStartingBalance`. The activation
flow fetches it itself; call it directly only to display which sponsor account is funding an
activation.

**Never hardcode the sponsor account.** Reading it from the service is precisely what makes a sponsor
rotation a config change instead of a coordinated client release. The values are served from the same
constants the server-side validator enforces, so what is published and what is accepted cannot drift.

The result is cached for `SPONSOR_CONFIG_TTL_MS` (60s, mirroring the server's
`Cache-Control: private, max-age=60`), keyed by effective base URL, with concurrent callers sharing
one in-flight request. Failures are never cached. Pass `forceRefresh: true` to bypass it.

## Configuration

The sponsoring service runs on its own host, so it gets its own `ApiConfig` slice and its own api key:

```ts
const sodax = new Sodax({
  api: {
    sponsoringApiConfig: {
      baseURL: 'https://api.sodax.com/v1',   // base URL incl. any version prefix — the SDK appends /sponsorships/stellar
      apiKey: process.env.SODAX_SPONSORING_API_KEY,
    },
  },
});
```

`apiKey` is sugar for the `x-api-key` header the service gates on; an explicit `x-api-key` in
`headers` wins, so you can proxy through your own backend instead. Keep the key in an env var — never
inline it — and read it server-side; see [API key good practices](https://docs.sodax.com/developers/how-to/api-key-good-practices).

The instance-wide `new Sodax({ apiKey })` is **gated** for this service: it is inherited only when the
call actually targets a SODAX gateway — the packaged sponsoring default or the resolved shared root —
and that check is made per request against the effective target, so a per-call `baseURL` override
cannot carry it off-gateway. A custom sponsoring origin never receives it. The slice key above is the
credential for independently hosted sponsoring and wins wherever the slice points. Sponsoring keys come
from their own registry, so a partner portal key that reaches sponsoring by inheritance is rejected —
always set the slice `apiKey`.

Two deliberate differences from `swapsApiConfig`:

- **`baseURL` does not inherit from `baseApiConfig`.** Every service resolves the same gateway root by
  default, sponsoring included — but it reaches that default independently rather than by inheritance,
  so pointing the base API at a private proxy or a staging host never silently drags the sponsoring
  calls along with it. Only an explicit `sponsoringApiConfig.baseURL` (or
  `DEFAULT_SPONSORING_API_ENDPOINT`) is used.
- **Headers do not inherit either.** Forwarding a consumer's `Authorization` — scoped to their own
  backend — to a different host would be a credential leak. Put a cross-cutting sponsoring header on
  `sponsoringApiConfig.headers`, or pass it per call.

`baseURL` is the service base URL **including any version or gateway prefix** — the SDK appends only
`SPONSORING_API_STELLAR_BASE_PATH` (`/sponsorships/stellar`), because where the service is mounted is
the deployment's business. This is the same rule every backend service now follows; see
[CONFIGURE_SDK.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md)
for the shared URL model. The packaged default is `https://api.sodax.com/v1`; point `baseURL` at
`http://localhost:3011` to run against a local `sponsoring-api`, which serves the routes at the bare
origin.

## React

`@sodax/dapp-kit` wraps all three methods:

```tsx
import { useActivateStellarAccount, useSponsorConfig, useStellarAccountActive } from '@sodax/dapp-kit';
```

| Hook | Kind | Notes |
| --- | --- | --- |
| `useStellarAccountActive` | query | `['sponsoring', 'stellarAccountActive', address]` |
| `useStellarAccountStatus` | query | `['sponsoring', 'stellarAccountStatus', address]`; the richer sibling — exists plus balances plus `canAffordTrustline` from one Horizon read. Prefer it whenever the next step involves a non-native token |
| `useSponsorConfig` | query | `['sponsoring', 'sponsorConfig']`, `staleTime: SPONSOR_CONFIG_TTL_MS` |
| `useActivateStellarAccount` | mutation | `['sponsoring', 'activateStellarAccount']`; on success invalidates the active-check and the Stellar balance query |

`apps/stellar-sponsor-example` is a runnable reference app for the whole flow. Its Test lab view
bundles a zero-dependency mock backend, so every failure class in the table above can be exercised
offline without a sponsoring service and without spending XLM.

## Related Documentation

- [Stellar Trustlines](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/STELLAR_TRUSTLINE.md) - The step after activation
- [Backend API](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/BACKEND_API.md) - The raw `sodax.api.sponsoring` wire client
- [Wallet Providers](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/WALLET_PROVIDERS.md) - Constructing a Stellar wallet provider
- [Configure SDK](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md) - Full `ApiConfig` reference
