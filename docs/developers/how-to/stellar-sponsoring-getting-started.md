---
title: "Stellar Sponsoring"
description: "Activate a brand-new Stellar account that holds no XLM, with SODAX paying the base reserve."
icon: star
---

A brand-new Stellar account holds 0 XLM, and Stellar accounts must exist on-chain before they can hold or receive anything. SODAX's sponsor account pays that account's base reserve, so activation costs the user nothing. The user's wallet still signs — only the account being created can authorize ending its own sponsorship — and the SODAX backend co-signs as sponsor and submits.

**Mainnet only.** For a destination token that isn't native XLM, there are three ordered steps:

1. **Activate** — free, sponsored. The account now exists and can receive.
2. **Receive XLM** — no trustline needed. This is what leaves the account able to pay a transaction fee.
3. **Add a trustline** for the non-native asset — only affordable once step 2 has landed.

`@sodax/dapp-kit`'s `useStellarGate` sequences all three for you; that's the fastest path if you're in React.

## Get an API key first

The Sponsoring API is gated by an `x-api-key` header — there's no self-serve signup. **Reach out to the SODAX team through any platform listed at [linktr.ee/go.sodax](https://linktr.ee/go.sodax) to request one** before integrating against the real backend. Without a valid key every call gets a `401`.

While you wait for a key, [`apps/stellar-sponsor-example`](https://github.com/icon-project/sodax-sdks/tree/main/apps/stellar-sponsor-example) ships an offline mock backend with a non-secret `mock-dev-key`, so you can build and test the whole flow before a real key arrives.

## Configure access

```ts
// Server-side: Node, a Route Handler or a Server Action
import { Sodax } from '@sodax/sdk';

const apiKey = process.env.SODAX_SPONSORING_API_KEY;
if (!apiKey) throw new Error('SODAX_SPONSORING_API_KEY is required');

const sodax = new Sodax({
  api: {
    sponsoringApiConfig: { apiKey }, // sugar for the x-api-key header
  },
});
```

In a React app, pass that same `api` object as `SodaxProvider`'s `config` prop instead of constructing `Sodax` yourself — read the key through `import.meta.env.VITE_SPONSORING_API_KEY` (Vite) rather than `process.env` on the client.

Every path below (dapp-kit, the SDK, or raw HTTP) reads this same key. Three things worth knowing before you wire it up:

- **Sponsoring resolves its own base URL and headers independently** of the SDK's shared `baseApiConfig` — pointing the top-level `baseURL` at a different host does **not** redirect sponsoring traffic along with it. Set `sponsoringApiConfig.baseURL` explicitly if you need to retarget it (e.g. to a local `sponsoring-api` at `http://localhost:3011`).
- **Never hardcode the sponsor account.** Call `sodax.sponsoring.getStellarSponsorConfig()` (or `GET /sponsorships/stellar/config`) if you need to display it — the sponsor can rotate, and the value is only correct read live.
- **A key shipped in a browser bundle is public by nature** — anyone can read it out of your JS. The service's per-key quotas and origin gating are the real control, not secrecy. If that's not acceptable for your deployment, point `sponsoringApiConfig.baseURL` at your own backend and inject the `x-api-key` header there instead of in the client — [API key good practices](/developers/how-to/api-key-good-practices) has a worked proxy.

## Pick an integration path

### React app → `@sodax/dapp-kit`

Use `useStellarGate` wherever a swap or bridge delivers to a Stellar destination — it sequences the three prerequisites and gives you one flag to block the main action on:

```tsx
import { useStellarGate } from '@sodax/dapp-kit';

const stellar = useStellarGate({
  dstChainKey: toChainKey,
  token: destinationToken,
  amount: destinationAmount,
  address: destinationAddress,
  walletProvider: destinationWalletProvider,
});

if (stellar.isChecking) return <Spinner label="Checking destination account…" />;
if (stellar.checkFailed) return <RetryButton error={stellar.error} onClick={stellar.retry} />;
if (stellar.needsActivation) {
  const onActivate = async () => {
    const result = await stellar.activate();
    if (result && !result.ok) showError(result.error);
  };
  return <Button loading={stellar.isActivating} onClick={onActivate}>Activate Stellar account (free)</Button>;
}
if (stellar.needsFunding) return <Notice>Send XLM to the destination first — it can't afford a trustline yet.</Notice>;
if (stellar.needsTrustline) {
  const onRequestTrustline = async () => {
    const result = await stellar.requestTrustline();
    if (result && !result.ok) showError(result.error);
  };
  return <Button loading={stellar.isRequestingTrustline} onClick={onRequestTrustline}>Add trustline</Button>;
}

return <SubmitButton disabled={stellar.blocksAction}>Continue</SubmitButton>;
```

`address` and `walletProvider` must be the same connected Stellar account — the account being activated is the only one that can sign, and the SDK verifies the signature against `address` before submitting, so a mismatched pair fails fast with an integration error rather than activating the wrong account.

`useStellarGate` composes four lower-level hooks — `useStellarAccountStatus`, `useStellarTrustlineCheck`, `useActivateStellarAccount`, `useEstablishTrustline` — for readers who need finer-grained control than the composite gate. It does **not** expose `onSignatureRequired`; for an activation-only flow that needs to explain a possible second signature prompt, call `useActivateStellarAccount` directly and pass `onSignatureRequired` in its mutation variables.

### Any TS/JS app (backend, script, non-React) → `@sodax/sdk`

```ts
const result = await sodax.sponsoring.activateStellarAccount({
  address: stellarAddress,
  walletProvider: stellarWalletProvider,
  onSignatureRequired: ({ reason }) => {
    // Fires right before each wallet prompt — a sequence conflict costs a second one.
    showWalletPrompt(reason === 'sequenceConflict' ? 'Please sign the rebuilt transaction.' : 'Approve activation.');
  },
});

if (!result.ok) {
  showError(result.error); // Branch on error.context.nextAction for retry/backoff — see SPONSORING.md's failure table.
} else if (result.value.status === 'alreadyActive') {
  // Also a success — the account already existed, nothing was submitted.
} else {
  console.log('activated in tx', result.value.hash);
}
```

`sodax.sponsoring` exposes `activateStellarAccount`, `isStellarAccountActive`, `getStellarAccountStatus`, and `getStellarSponsorConfig` — all return `Result<T>` and never throw. Prefer `getStellarAccountStatus` over the plain `isStellarAccountActive` boolean whenever the next step might need a trustline — it also reports spendable balance and `canAffordTrustline` from the same Horizon read.

### Any language / no SDK → the backend API directly

```bash
# Read the sponsor's current build parameters
curl --fail-with-body https://api.sodax.com/v1/sponsorships/stellar/config \
  -H "x-api-key: $SODAX_SPONSORING_API_KEY"

# Submit a signed activation transaction
curl --fail-with-body -X POST https://api.sodax.com/v1/sponsorships/stellar/accounts \
  -H "x-api-key: $SODAX_SPONSORING_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"data": "<base64 tx XDR, signed by the account being created>"}'
```

Interactive OpenAPI/swagger reference: https://api.sodax.com/v1/sponsorships/docs

Without the SDK, you build that XDR yourself: a "sponsorship sandwich" of `beginSponsoringFutureReserves` (sponsor) → `createAccount` with `startingBalance` from `/config` (currently `"0"`) (sponsor) → `endSponsoringFutureReserves` (the new account), using the fee band, network passphrase, and time bounds also returned by `/config` — then have the new account sign it before POSTing. `sodax.sponsoring.activateStellarAccount` does exactly this construction for you, which is the main reason to prefer it over this path.

The `accounts` response is one of two shapes — `{ hash: string, alreadyActive: false }` for a submitted activation, or `{ hash: null, alreadyActive: true }` when the account already existed. Both are success. A TypeScript caller who wants to build the XDR by hand (as above) but skip raw `curl`/`fetch` boilerplate can call the same two operations through `sodax.api.sponsoring` — it's a typed wire client, not an orchestrator, so it still leaves the XDR construction, config caching, and retry policy to the caller.

## Examples

Config wiring lives in the `sponsoringApiConfig` object in [`apps/demo/src/providers.tsx`](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/providers.tsx) (built from `VITE_SPONSORING_API_BASE_URL` / `VITE_SPONSORING_API_KEY`, then passed to `Sodax` as `api.sponsoringApiConfig`; env placeholders at [`example.env`](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/example.env#L8)). Start it from the repo root and open a route below:

```bash
pnpm build:packages   # first time only, if the SDK packages aren't built yet
pnpm dev:demo         # http://localhost:3000
```

| Route | What to inspect | Source |
| --- | --- | --- |
| [`/bridge`](http://localhost:3000/bridge) | The shortest `useStellarGate` call site — gate at L85, activate/trustline handlers at L122-134, gated UI states at L170-257 | [`BridgeDialog.tsx`](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/components/bridge/BridgeDialog.tsx#L85) |
| [`/swaps-sdk`](http://localhost:3000/swaps-sdk) | Same gate pattern on a swap/limit-order destination | [`SwapCard.tsx`](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/components/swaps/SwapCard.tsx#L109), [`LimitOrderCard.tsx`](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/components/swaps/LimitOrderCard.tsx#L74) |
| [`/swaps-api`](http://localhost:3000/swaps-api) | The same gate driving an API-submitted swap instead of the SDK path | [`SwapCard.tsx`](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/components/swaps-api/SwapCard.tsx#L302) |

For a focused, standalone walkthrough with its own offline mock backend:

```bash
cp apps/stellar-sponsor-example/example.env apps/stellar-sponsor-example/.env
pnpm --filter stellar-sponsor-example mock-sponsoring   # terminal A — offline sponsoring + Horizon double
pnpm --filter stellar-sponsor-example dev               # terminal B — http://localhost:3003
```

| Route | What to inspect |
| --- | --- |
| [`#/showcase`](http://localhost:3003/#/showcase) | The three-step integrator journey (activate → fund → trustline) to copy end-to-end |
| [`#/lab`](http://localhost:3003/#/lab) | A scenario runner exercising the full failure taxonomy offline — press **Run all** |

`#/lab` is enabled by default in dev; a production build only includes it with `VITE_ENABLE_LAB=true`. See the app's [`README.md`](https://github.com/icon-project/sodax-sdks/blob/main/apps/stellar-sponsor-example/README.md) for the full walkthrough and its API-key security notes.

Two more references:

- **Headless (no React)** — [`apps/node/src/stellar-sponsor.ts`](https://github.com/icon-project/sodax-sdks/blob/main/apps/node/src/stellar-sponsor.ts) calls `sodax.sponsoring` directly from a plain Node script.
- **Terser reference card** — [`docs/quick-sponsoring-stellar-guide.md`](https://github.com/icon-project/sodax-sdks/blob/main/docs/developers/how-to/quick-sponsoring-stellar-guide.md), a denser bullet-point version of this same feature.

## Learn more

- [`packages/sdk/docs/SPONSORING.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SPONSORING.md) — full method reference, error-handling table, retry semantics.
- [`packages/sdk/docs/STELLAR_TRUSTLINE.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/STELLAR_TRUSTLINE.md) — trustline mechanics for non-native tokens.
- [`packages/sdk/docs/CONFIGURE_SDK.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md) — full `ApiConfig` reference.
