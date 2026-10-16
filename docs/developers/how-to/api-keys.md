---
title: "SODAX API keys"
sidebarTitle: "API keys"
description: "Why your integration needs a SODAX API key, how to create one in the partner portal, and how to deploy, rotate and revoke it."
icon: key
---

An API key identifies your organisation on requests to the SODAX API. If you arrived here from the **API keys** panel in the partner portal, this page explains what that key is for, where to put it, and how to rotate it without downtime.

## Why you need one

Two reasons, one of which matters today and one of which matters soon.

**Today: it makes your traffic yours.** Requests carrying your key are attributed to your organisation. That is what lets SODAX see your integration's usage separately from anonymous traffic — the basis for supporting you, for raising your limits, and for the per-organisation usage view in the portal.

**Soon: it will be required.** The write paths of the Swaps and Leveraged Yield APIs are already wired for key checking. It is currently switched off on the public deployments and will be turned on route by route, deployment by deployment. Integrations already sending a valid key when that happens keep working with no change; integrations sending nothing start receiving `401`.

So the useful thing to do now is create a key, deploy it, and forget about it. The switch then costs you nothing.

<Note>
  **A key is not enforced anywhere yet, so you cannot test that yours works.** Requests with no key, and requests with a wrong or revoked key, are both served normally today. Do not read a `200` as evidence your key is valid — check the prefix against the portal instead.
</Note>

## What a key does and doesn't cover

Key checking is per route, and only the routes that make the backend *do* something carry it.

| Surface | Is a key checked? |
| --- | --- |
| `POST /v1/swaps/*` — 13 routes | **Wired, currently off.** Each declares a scope. Not enforced on public deployments yet. |
| `POST /v1/leverage-yield/*` | **Wired, currently off.** Same scopes as swaps — the two APIs share one vocabulary. |
| `GET /v1/swaps/*` and `GET /v1/leverage-yield/*` | **No.** Token lists, deadlines, fee reads, intent lookups and status polls are public reads and carry no scope. |
| `/v1/be/*`, `/v1/a/*`, `/v1/intent/*` | **No, by design.** The data, Sonic and solver APIs are deliberately not wired for key checking. |
| `/v1/sponsorships/*` — Stellar sponsoring | **Yes, enforced today.** But *not* with a portal key — see [Sponsoring keys are separate](#sponsoring-keys-are-separate). |

Enforcement has three states per deployment — off, monitor, and enforce. Monitor runs the identical check and records the outcome without rejecting anything; a route only moves to enforce after a period of monitoring shows no legitimate traffic arriving without a key. Rollback is a return to monitor.

## What an API key is

A SODAX API key is a secret string your **server** attaches to each HTTP request so the API knows which organisation is calling. It is the literal `sodax_` prefix followed by 32 random bytes in base64url:

```
sodax_8Kj2mNp4Qr7sTv9wXy1zAb3cDe5fGh6iJk0lMnOpQrS
```

It is not a blockchain key and has no relationship to one:

| An API key | A wallet key |
| --- | --- |
| Identifies your organisation to the SODAX API | Controls funds on-chain |
| Cannot sign a transaction, move a token, or approve a spend | Signs and authorises transfers |
| Replaceable — revoke it and create another | Loss or leak means loss of funds |
| Held by your backend | Held by the end user's wallet |

A leaked API key lets someone else make API calls attributed to your organisation. It does not let them touch anyone's funds. Users still sign their own transactions with their own wallets.

## Who can create one

Keys belong to an organisation, not to a person. You need a partner portal account that is a member of one.

| Role in the organisation | See the key list | Create a key | Revoke a key |
| --- | --- | --- | --- |
| Owner | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes |
| Member | Yes | No | No |

Members see each key's name, its non-secret prefix, its permissions and when it was created — never the secret itself, which nobody can read back after creation.

## Creating a key

**The full key is displayed exactly once, at the moment you create it.** It is stored as a SHA-256 hash, so it cannot be shown again, recovered, or emailed to you. If you navigate away before copying it, that key is unusable and the only fix is to revoke it and create another. Have somewhere to paste it before you click Create.

1. Open the **API keys** panel in the partner portal and choose your organisation.
2. Enter a name, up to 64 characters — for example `production` or `staging-worker`.
3. Click **Create key**.
4. Copy the full key from the panel and store it (see [Where to put it](#where-to-put-it) and [API key good practices](/developers/how-to/api-key-good-practices)).
5. Click **Done** to dismiss the reveal.

The name is a local label so you can tell your keys apart in the portal. It is not part of the key, it is not sent on requests, and renaming has no effect on anything.

After you dismiss the reveal, the list shows only the key's prefix — `sodax_` plus the first eight characters of the secret, like `sodax_8Kj2mNp4` — followed by dots. The prefix is not secret; it exists so you can tell which stored key is which.

## Where to put it

The key belongs on a server you control, loaded from the environment or a secret manager.

```bash
# .env on your server — git-ignored, never committed
SODAX_API_KEY=sodax_8Kj2mNp4Qr7sTv9wXy1zAb3cDe5fGh6iJk0lMnOpQrS
```

| Do | Don't |
| --- | --- |
| Read it from an environment variable or a secret manager | Paste it into source code |
| Keep it server-side | Ship it in a browser bundle, mobile app, or anything that reaches a user's device |
| Add `.env` to `.gitignore` | Commit it, or put it in a Dockerfile, CI log, or issue |
| Give each environment its own key | Share one key between production and staging |

Anything a browser downloads is readable by whoever downloaded it, so a key in front-end JavaScript is a published key — and so is one behind a `NEXT_PUBLIC_*`, `VITE_*` or `REACT_APP_*` variable. [API key good practices](/developers/how-to/api-key-good-practices) shows how to keep the call on your server, or proxy it through your own backend, when the SDK runs in a browser.

### The header

The key goes in an `x-api-key` request header.

```bash
curl -X POST https://api.sodax.com/v1/swaps/quote \
  -H "Content-Type: application/json" \
  -H "x-api-key: $SODAX_API_KEY" \
  -d '{
    "tokenSrc": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "tokenSrcChainKey": "0xa4b1.arbitrum",
    "tokenDst": "0x29219dd400f2Bf60E5a23d13Be72B486D4038894",
    "tokenDstChainKey": "sonic",
    "amount": "1000000",
    "quoteType": "exact_input"
  }'
```

The SDKs set that header for you when you pass the key in configuration:

```typescript
// @sodax/sdk — one instance-wide key. Server-side only: Node, a Route Handler or a Server Action.
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax({ apiKey: process.env.SODAX_API_KEY });
```

It rides every SODAX backend transport the instance uses: the data API, `sodax.api.swaps`, `sodax.api.bridge`, the solver API, and the backend submit-tx legs of `sodax.swaps.swap()` and `sodax.bridge.bridge()`. Sponsoring is the exception — see [below](#sponsoring-keys-are-separate).

```typescript
// @sodax/swaps-api — the standalone HTTP client. Server-side only.
import { SwapsApi } from '@sodax/swaps-api';

const api = new SwapsApi({
  baseUrl: 'https://api.sodax.com/v1',
  apiKey: process.env.SODAX_API_KEY,
});
```

An explicit `headers['x-api-key']` beats the `apiKey` option in both packages. The SDK resolves a longer precedence chain for per-call overrides — see [Configure SDK](/developers/how-to/configure_sdk) for the full order.

## Permissions

Every key minted from the portal carries both scopes. Scopes are fixed server-side — the portal offers no picker, and you cannot request a narrower or wider key. A SODAX operator can narrow a specific key afterwards if you ask.

| Scope | Portal label | What it permits |
| --- | --- | --- |
| `swaps:read` | Read swaps | Quotes, gas estimates, allowance checks, intent status, hash, packet and extra-data lookups, and `approve` — the builders that hand you an unsigned transaction to sign yourself. |
| `swaps:write` | Execute swaps | Calls that make the backend act for you: creating, submitting and cancelling intents and limit orders, and `submit-tx`. |

The split follows what a call *causes*, not its HTTP verb. Verb is a poor guide here because many read-only calls are POSTs — a quote request carries a body that will not fit in a query string. Both scopes cover the Leveraged Yield routes too, which reuse the same vocabulary rather than defining their own.

## Two keys, and why

An organisation may hold **two active keys at once**. This is the rotation mechanism, not a quota — the second slot exists so you always have somewhere to put the replacement.

Rotating without downtime:

1. **Create** the second key in the portal. Both keys now work.
2. **Deploy** it — update the secret everywhere your code reads it, and confirm the new key is live in every environment and region.
3. **Revoke** the first key.

Doing it in the other order — revoking first, then creating — leaves a window in which your integration has no working key. Once enforcement is on, that window is an outage.

Because the cap is two, avoid holding two keys longer than a rotation needs. At the cap, creating is blocked until you revoke one.

## Revoking a key

Revoking **deletes** the key. It is not a disable, there is no revoked state, and there is nothing to restore. If you revoke the wrong key, the fix is to create a new one and deploy it.

The portal asks you to confirm, and warns you when the key you are revoking is your organisation's only one.

Revocation is not instant. Each API service holds a cached copy of the active key set and refreshes it every 15 seconds, so a revoked key usually stops working within about 15 seconds. It can take longer: a service that cannot refresh its copy keeps serving the last good one rather than failing closed, and there is no guaranteed ceiling. Treat revocation as prompt, not immediate — if a key has leaked, revoke it and then confirm the leak is contained by other means. See [If a key has already shipped](/developers/how-to/api-key-good-practices#if-a-key-has-already-shipped).

## When something goes wrong

Once enforcement is enabled on a route, a rejected request looks like this:

| Status | Body message | Meaning | What to do |
| --- | --- | --- | --- |
| `401` | `Missing x-api-key` | No key on the request. | Check the header name and that your environment variable is actually set in the running process. |
| `401` | `Invalid API key` | The key isn't one we issued, or it was revoked. | Compare against the prefix shown in the portal. If it was revoked, create and deploy a new one. |
| `403` | `API key is missing the … scope` | Valid key, but narrowed so it can't make this call. | Contact SODAX to widen it, or use a key that carries the scope. |
| `403` | `This organisation is suspended` | An operator has suspended the organisation. | Contact SODAX. None of your keys will work until it is lifted. |
| `503` | `API key verification is temporarily unavailable` | Our side can't check keys right now. Your key is probably fine. | Retry. Don't rotate keys in response to this. |

Both `@sodax/sdk` and `@sodax/swaps-api` already retry that `503` for you, with backoff, and treat it as safe to replay even for a mutation — the request was rejected before it reached the route handler. You should not need to handle it yourself.

Errors from the portal while managing keys:

| Status | Meaning | What to do |
| --- | --- | --- |
| `409` | You already hold two active keys. | Revoke one, then create the replacement. |
| `404` on revoke | The key is already gone — someone revoked it in another session. | Nothing. The list refreshes itself. |
| `503` *"not configured on this deployment"* | This portal deployment is missing its key-service configuration. | Nothing to retry. Contact SODAX support. |

### A create request that never confirms

If creating a key fails with a `503` or the request never completes, **do not retry it.** The key is generated inside the API and the plaintext is returned exactly once, so a request that reached the server but never got back to you may have created a real key that nobody holds — one that occupies a slot and can never be used.

Refresh the key list first and see what actually exists:

- **A new key is listed** that you don't hold the secret for → revoke it, then create a replacement.
- **Nothing new is listed** → the mint didn't happen. Create again.

The portal blocks the create button until you refresh, for exactly this reason. Retrying blindly is how an organisation ends up at the two-key cap with one unusable key.

## Sponsoring keys are separate

The [Stellar Sponsoring API](/developers/how-to/stellar-sponsoring-getting-started) (`/v1/sponsorships/*`) also uses an `x-api-key` header, and it **does** enforce it today — but it runs on its own separate key registry. A key you mint in the partner portal will not work there, and a sponsoring key will not work on the swaps routes.

Sponsoring keys are not self-serve. Request one from the SODAX team, as described on that page.

<Note>
  If you use both, set the sponsoring key on its own config slice — `api.sponsoringApiConfig.apiKey`. Without it, an instance-wide `new Sodax({ apiKey })` will reach sponsoring whenever the call targets a SODAX gateway root, and a portal key sent there is rejected.
</Note>

## Get help

<CardGroup cols={2}>
  <Card title="Discord" icon="discord" href="https://www.sodax.com/discord">
    Integration questions, including anything about keys and enforcement timing.
  </Card>
  <Card title="Contact the team" icon="envelope" href="/contact">
    Partnerships, org and role changes, and narrowing a key's scopes.
  </Card>
</CardGroup>
