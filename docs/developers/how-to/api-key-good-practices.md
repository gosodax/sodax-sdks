---
title: "API key good practices"
sidebarTitle: "API key good practices"
description: "Keep a SODAX API key on a server you control: where the SDK may hold it, the build-time env prefixes that publish it, and a worked backend-for-frontend proxy for browser dApps."
icon: lock
---

[API keys](/developers/how-to/api-keys) covers creating, rotating and revoking a key. This page covers where it lives once you have it — in particular in a browser dApp, where the obvious fix for a missing key is the one that publishes it.

Keep this in proportion. A SODAX API key is [not a wallet key](/developers/how-to/api-keys#what-an-api-key-is): it cannot sign a transaction, move a token or approve a spend. A leaked key costs you misattributed traffic, quota consumed against your organisation, and a forced rotation — not anyone's funds. What follows is deployment guidance, not an incident response plan.

## Decide where the call runs

The key is safe wherever the code that holds it never reaches a user's device.

| Where `new Sodax({ apiKey })` runs | Is the key private? |
| --- | --- |
| A Node service, bot, worker or script | **Yes** — read it from `process.env` or a secret manager. |
| A Next.js Route Handler, Server Action or React Server Component | **Yes** — server-only code, as long as the value is not `NEXT_PUBLIC_*`. |
| A browser: a `'use client'` component, a Vite or CRA single-page app, `SodaxProvider` from `@sodax/dapp-kit` | **No** — it ships in the bundle. |
| A mobile or desktop app bundle | **No** — anything installed on the device can be extracted. |

`SodaxProvider` does `new Sodax(config)` inside your React tree, so any `apiKey` you pass it is a browser key. Configure it with a proxy instead — see [Pattern 2](#pattern-2-proxy-through-your-own-backend).

### Public env prefixes publish, they don't protect

A server-side snippet like `new Sodax({ apiKey: process.env.SODAX_API_KEY })` reads `undefined` in a client component. The tempting fix is to rename the variable so the framework exposes it:

| Prefix | Framework | What it does |
| --- | --- | --- |
| `NEXT_PUBLIC_*` | Next.js | Inlined into the client bundle at build time |
| `VITE_*` | Vite | Inlined into the client bundle at build time |
| `REACT_APP_*` | Create React App | Inlined into the client bundle at build time |

These prefixes are a publication mechanism, not an access mechanism. The build succeeds, the app works, and the key is now served to every visitor and baked into every bundle you have deployed. If you can read it in devtools → Sources, so can everyone else.

Use the prefixes for values that are meant to be public — a WalletConnect project ID, your own app's origin — never for the SODAX key.

## Pattern 1: keep the call on the server

If your app already renders on a server, the simplest fix is to make the SODAX call there and send the browser only the result. No proxy is needed.

```typescript
// app/actions/quote.ts — server-only (a Next.js Server Action)
'use server';

import 'server-only';
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax({ apiKey: process.env.SODAX_API_KEY });

export async function getSwapTokens() {
  const result = await sodax.api.swaps.getTokens();
  if (!result.ok) throw new Error('Could not load swap tokens');
  return result.value;
}
```

The same applies to a React Server Component, a Route Handler that returns your own response shape, or any backend endpoint. The `server-only` package makes the build fail if a client component imports the module.

This works for reads, quotes and backend submissions. It does not help with anything the user's wallet must sign in the browser — for that, the browser needs an SDK instance of its own, which is what Pattern 2 is for.

## Pattern 2: proxy through your own backend

A backend-for-frontend (BFF) keeps the full SDK in the browser but points it at your own origin. Your server forwards each request to the SODAX gateway and attaches the key on the way out.

### The route handler

```typescript
// app/api/sodax/[...path]/route.ts — server-only (a Next.js Route Handler)
const UPSTREAM = 'https://api.sodax.com/v1';
const MOUNT = '/api/sodax';
const ALLOWED_PREFIXES = ['/be/', '/swaps/', '/bridge/', '/leverage-yield/', '/intent/'];

async function forward(request: Request): Promise<Response> {
  const apiKey = process.env.SODAX_API_KEY;
  if (!apiKey) return Response.json({ message: 'Proxy is not configured' }, { status: 500 });

  const { pathname, search } = new URL(request.url);
  const path = pathname.slice(MOUNT.length);
  if (!ALLOWED_PREFIXES.some(prefix => path.startsWith(prefix))) {
    return Response.json({ message: 'Not found' }, { status: 404 });
  }

  const headers = new Headers();
  for (const name of ['content-type', 'accept']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('x-api-key', apiKey);

  const upstream = await fetch(`${UPSTREAM}${path}${search}`, {
    method: request.method,
    headers,
    body: request.method === 'GET' ? undefined : await request.text(),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

export const GET = forward;
export const POST = forward;
```

The handler builds its outgoing headers from scratch, so any `x-api-key` the browser sends — in any casing — never reaches SODAX. The upstream is a constant, and the path must start with a prefix you chose. It derives the path from the request URL rather than from the route's `params`, so it does not depend on the Next.js version.

### The browser config

```typescript
// providers/sodax-config.ts — browser: holds no key
import type { HttpUrl, SodaxOptions } from '@sodax/sdk';

const isHttpUrl = (value: string): value is HttpUrl =>
  value.startsWith('https://') || value.startsWith('http://');

// Your own app's public origin, e.g. https://app.example.com — not a secret.
const origin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'http://localhost:3000';
if (!isHttpUrl(origin)) throw new Error(`NEXT_PUBLIC_APP_ORIGIN must be an http(s) URL, got ${origin}`);

export const sodaxConfig: SodaxOptions = {
  api: { baseURL: `${origin}/api/sodax` },
  solver: { solverApiEndpoint: `${origin}/api/sodax/intent` },
};
```

Pass `sodaxConfig` to `<SodaxProvider config={sodaxConfig}>` or `new Sodax(sodaxConfig)`. There is no `apiKey` in it, and none is needed: the proxy adds the key.

Both URLs are absolute because the SDK requires an `http(s)` URL, and a client component also renders on the server, where there is no `window.location` to resolve a relative path against.

### The same shape anywhere

Nothing here is specific to Next.js. An Express or Hono route, a Cloudflare Worker, or an API gateway rule does the same job: accept a request under your mount, check the path against your allowlist, rebuild the headers with `x-api-key` from your server's secret store, and forward to `https://api.sodax.com/v1`.

## What the proxy has to cover

The SDK is not a single-route client, and one `api.baseURL` does not move all of it. A proxy that forwards `/be` and leaves the solver pointed at `api.sodax.com` is a silent half-migration: the app keeps working, and the calls you didn't move go out without a key.

| SDK traffic | Gateway path | How the SDK is pointed at your proxy | Carries the key? | Proxy it? |
| --- | --- | --- | --- | --- |
| Data API | `/v1/be/*` | `api.baseURL` | Yes | Yes |
| Swaps API (`sodax.api.swaps`, the submit-tx leg of `sodax.swaps.swap()`) | `/v1/swaps/*` | `api.baseURL`, or `api.swapsApiConfig.baseURL` | Yes | Yes |
| Bridge API | `/v1/bridge/*` | `api.baseURL` | Yes | Yes |
| Leveraged Yield API | `/v1/leverage-yield/*` | `api.baseURL` | Yes | Yes |
| Solver | `/v1/intent/*` | `solver.solverApiEndpoint` — separate, not derived from `api.baseURL` | Yes | **Yes** |
| Relayer | `/v1/relay/*` | `relay.relayerApiEndpoint` | **Never** | Not needed |
| Stellar sponsoring | `/v1/sponsorships/*` | `api.sponsoringApiConfig.baseURL` — never inherits `api.baseURL` | Its own sponsoring key | Separately — see [Sponsoring keys](#sponsoring-keys) |
| Hub and spoke chain RPCs | — | `hub.rpcUrl` and each chain's `rpcUrl` | No SODAX key | No |

Sources: the packaged defaults are in [`packages/types/src/common/constants.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/common/constants.ts), and how each service resolves its base URL is in [`packages/sdk/src/backendApi/apiConfig.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/src/backendApi/apiConfig.ts). See [Configure SDK](/developers/how-to/configure_sdk) for the full layering.

Two details that decide the proxy's shape:

- **Mount the proxy at the gateway root, not the data API.** Your `api.baseURL` stands in for `https://api.sodax.com/v1`. A base URL ending in `/be` is treated as the legacy data-API mount: the SDK trims the suffix and logs a warning, so `/api/sodax/be` would quietly be treated as `/api/sodax`: the app keeps working, but only a console warning tells you the base URL was rewritten.
- **Only `Content-Type` and `Accept` need forwarding.** The SDK sends no other SODAX-specific request headers. It sends `Content-Type: application/json` on every method, including `GET`, so a proxy on a different origin gets a CORS preflight on every call. A same-origin proxy, like the route handler above, avoids that entirely.

## Your proxy is now your problem

A forwarder that attaches your organisation's key and accepts anything from anyone is an open relay for your quota. Before you ship it:

- **Authenticate or rate-limit it.** Tie it to your own session or app check if you have one, and rate-limit per client either way.
- **Forward only the paths you use.** Trim `ALLOWED_PREFIXES` to the services your app calls, and allow only `GET` and `POST`.
- **Never forward to a URL the client chose.** Keep the upstream a constant; don't read a target host from a header, query parameter or body.
- **Don't log the key.** Keep `x-api-key` out of request logs, error reports and traces, on the proxy and anything in front of it.

## If you ship a key in the browser anyway

Sometimes there is no backend — a prototype, a static demo, a hackathon build. Shipping a key in the bundle is then a trade-off you can make knowingly, as long as you treat the key as public:

- **Give that app its own key**, separate from your server's, so rotating it touches nothing else. Every portal key carries the same scopes; there is no narrower "browser" key.
- **Expect to rotate it.** Anyone can copy it and send traffic that is attributed to your organisation and counts against your limits. Once [enforcement](/developers/how-to/api-keys#why-you-need-one) is switched on, the copied key also passes the checks your own traffic relies on.
- **Nothing else changes.** Users still sign every transaction with their own wallets; the key gives nobody access to funds.

Move it behind a server before you depend on the traffic being yours.

## Storage checklist

- Read the key from an environment variable or a secret manager, never from source.
- Give each environment its own key — production and staging never share one.
- Keep `.env` in `.gitignore`; put the key in your CI or host's secret store, not in a Dockerfile or build log.
- Keep it out of logs, error reports and issue trackers.

## If a key has already shipped

1. **Rotate it** with the [two-key procedure](/developers/how-to/api-keys#two-keys-and-why): create the replacement, deploy it server-side, then revoke the published key.
2. **Remove it from the bundle.** Move the call behind a server, rebuild without the key, and redeploy.
3. **Treat containment as a separate step.** Revocation usually takes effect within about 15 seconds, with [no guaranteed ceiling](/developers/how-to/api-keys#revoking-a-key). Old bundles may stay in browser caches and CDNs after you redeploy, so purge your CDN, and don't reuse the published key anywhere.

## Sponsoring keys

The [Stellar Sponsoring API](/developers/how-to/stellar-sponsoring-getting-started) uses its own key from a [separate registry](/developers/how-to/api-keys#sponsoring-keys-are-separate). Handle it exactly like a portal key — server-side, one per environment — and set it on its own config slice, `api.sponsoringApiConfig.apiKey`. Pointing `api.baseURL` at your proxy does not move sponsoring: its base URL and headers never inherit, so proxy it separately if you call it from a browser.
