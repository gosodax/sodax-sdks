# stellar-sponsor-example

Vite + React app showing Stellar account activation and the two steps that follow, through `@sodax/dapp-kit`.

A Stellar account must exist on-chain before it can hold or receive anything, and a brand-new user
holds 0 XLM. The SODAX sponsoring service pays the account's base reserve using Stellar's
sponsored-reserve flow. The user's own wallet signs — their signature is what authorises
`endSponsoringFutureReserves` — and the backend co-signs as the sponsor and submits.

> **Mainnet only.** The sponsoring service rejects a testnet Horizon *by design*, and the SDK asserts
> the public network before any wallet prompt. A successful activation spends a small amount of real
> XLM. Every *failure* path costs nothing, and the bundled mock backend makes all of them reachable
> offline — start there.

## Two views

| View | Link | What it is for |
| --- | --- | --- |
| **Showcase** | `#/showcase` | The complete three-step journey, wired the way an integrator should copy it |
| **Test lab** | `#/lab` | Diagnostics: switch backends, run every failure class as an assertion, inspect the raw errors |

Views are hash-routed, so `…/#/lab` is a shareable link to a repro. The lab is available in `pnpm dev`
and in a production build only when `VITE_ENABLE_LAB=true` — it exposes a real-mainnet switch.

## Running it

```bash
cp example.env .env
pnpm --filter stellar-sponsor-example mock-sponsoring   # terminal A
pnpm --filter stellar-sponsor-example dev               # terminal B
```

Serves on <http://localhost:3003>; the mock backend on port 9011. Open the Test lab and press
**Run all** — the whole failure taxonomy runs against the mock, offline, in a couple of seconds.

To point at a real deployment instead, set `VITE_SPONSORING_API_BASE_URL` (unset uses the SDK's
packaged endpoint) and `VITE_SPONSORING_API_KEY` — both endpoints are `x-api-key` gated. Put the
`.env` in this directory, not in `src/`: Vite reads env files from the project root.

## The three ordered steps

Activation makes the account able to **receive**, not to **send** — sponsored create uses
`startingBalance: 0`, so the sponsor covers the account entry and the account itself holds nothing.

1. **Activate** — free to the user. The account now exists and can receive.
2. **Receive XLM** — needs no trustline, and costs the recipient nothing. This is what makes the
   account able to act.
3. **Add trustlines** for other assets — now affordable, since the account holds XLM.

The Showcase renders whichever single step is outstanding, with the account's total *and spendable*
balance side by side — the gap between them is the whole point.

## What it demonstrates

| Hook | Where |
| --- | --- |
| `useSponsorConfig` | which sponsor account is funding this, read from the server rather than hardcoded |
| `useStellarAccountStatus` | exists + balances + `canAffordTrustline` + `trustlineMinXlmStroops`, from one Horizon account read |
| `useActivateStellarAccount` | the activation itself |
| `useStellarTrustlineCheck` / `useEstablishTrustline` | the step after activation |
| `useStellarAccountActive` | in the lab, beside the status read — the contrast is the lesson |
| `resolveStellarGate` | the ordering invariant, borrowed rather than re-derived |

The UI deliberately covers the cases a naive integration gets wrong:

- **`alreadyActive` is a success**, not a silent no-op. It is rendered distinctly from a fresh
  activation, and it reports whether the client-side pre-flight caught it before any wallet prompt.
- **"We don't know" is not "not activated."** A failed Horizon read never renders as an inactive
  account — that would push a user with a perfectly good account into a pointless activation.
- **A sequence conflict is explained before the second prompt appears.** The sponsor's sequence
  number is baked into the signed payload, so if another activation lands first the transaction must
  be rebuilt and re-signed. `onSignatureRequired` fires *before* the wallet steals focus, so the
  "please sign again" banner is already on screen.
- **Each failure class gets its own next action**, keyed on `error.context.nextAction` rather than
  the HTTP status — two different 503s mean "wait and retry" and "an operator must intervene".
- **An activated account is not a usable one.** The funding step exists because a sponsored account
  holds nothing spendable, and "total balance" overstates what it can spend by one base reserve per
  subentry.

## The Test lab

Two tiers, because reachability differs enormously:

- **Wire tier** — calls the endpoints directly and checks `classifySponsorError` against a
  hand-written expectation. No wallet, no Horizon, no signing; it covers every failure class on a
  fresh clone with nothing but the mock running.
- **Orchestration tier** — drives the real `useActivateStellarAccount` mutation, covering what the
  wire tier cannot: attempt counts, the conflict → re-sign → success chain, and the silent
  same-payload Horizon retry. These rows need a connected wallet holding an account that does not
  exist on-chain, and grey out with the missing precondition named until they have one.

Also in the lab: runtime target switching with a readout of what the SDK *actually* resolved, the
activation knobs (`allowSequenceRetry`, `maxHorizonRetries`, `forceConfigRefresh`), a hard sponsor-config
refresh, and an event log fed by the SDK's own analytics and mutation-error seams.

Run-all is only enabled against the mock, where nothing is ever submitted to Stellar. Selecting
**Real mainnet** requires a typed confirmation and shows a persistent warning.

## Api key handling

An `x-api-key` shipped in a browser bundle is public by nature. The service's per-key quotas,
fleet-wide daily cap, per-IP throttle, and origin gating are the real controls. If that is not
acceptable for your deployment, point `baseURL` at your own backend and inject the header there — see [API key good practices](https://docs.sodax.com/developers/how-to/api-key-good-practices).

`example.env` ships `mock-dev-key`, which is the bundled mock's non-secret default. Never commit a
real key here.
