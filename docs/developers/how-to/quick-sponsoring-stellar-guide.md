---
title: "Stellar Sponsoring: Quick Reference"
description: "The sponsored Stellar activation flow as a dense reference card."
icon: bolt
---

A new Stellar account must exist on-chain before it can receive anything, and a new user has 0 XLM.
SODAX's sponsor pays the base reserve. The user's wallet signs; the backend co-signs and submits.
Mainnet only. In swaps when destination is XLM account is has to be activated to be able to receive XLM (other assets require trustline).

**Ordered prerequisites** (a non-native destination token needs all three):
1. Activate — free, sponsored.
2. Receive XLM — the account is left with zero spendable balance, so it still can't pay a fee.
3. Add trustline — affordable only after step 2.

**Surface** — `sodax.sponsoring`: `activateStellarAccount`, `getStellarAccountStatus`,
`isStellarAccountActive`, `getStellarSponsorConfig`. All return `Result`. Config goes in
`sponsoringApiConfig` (own host, own `x-api-key`, inherits nothing).

**React** — use `useStellarGate`; it sequences all three. Pieces: `useActivateStellarAccount`,
`useStellarAccountStatus`, `useSponsorConfig`, `useEstablishTrustline`.

**Gotchas**
- `alreadyActive` is a success, not a no-op.
- Branch on `error.context.nextAction`, not status — the two 503s want opposite handling.
- A sequence conflict costs a second wallet prompt; wire `onSignatureRequired`.
- Never hardcode the sponsor account; read it from config.
- A key in a browser bundle is public; see [API key good practices](/developers/how-to/api-key-good-practices).

**Docs** — [SPONSORING.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SPONSORING.md) ·
[STELLAR_TRUSTLINE.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/STELLAR_TRUSTLINE.md) ·
[CONFIGURE_SDK.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md)

**Examples**
- [apps/demo/src/providers.tsx](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/providers.tsx) — sponsoring API URL + key setup: the `sponsoringApiConfig` object reads `VITE_SPONSORING_API_BASE_URL` / `VITE_SPONSORING_API_KEY`, omits each when unset (falls back to the packaged endpoint), and is passed as `api.sponsoringApiConfig` on the `Sodax` config below. Env placeholders in [apps/demo/example.env](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/example.env).
- [apps/stellar-sponsor-example](https://github.com/icon-project/sodax-sdks/tree/main/apps/stellar-sponsor-example) — full journey + offline mock (`cp example.env .env`, `pnpm mock-sponsoring`, `pnpm dev`, Test lab → Run all)
- [swaps/SwapCard.tsx](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/components/swaps/SwapCard.tsx) — swap gated on a Stellar destination; also [swaps-api/SwapCard.tsx](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/components/swaps-api/SwapCard.tsx), [LimitOrderCard.tsx](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/components/swaps/LimitOrderCard.tsx), [BridgeDialog.tsx](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/components/bridge/BridgeDialog.tsx)
- [apps/node/src/stellar-sponsor.ts](https://github.com/icon-project/sodax-sdks/blob/main/apps/node/src/stellar-sponsor.ts) — headless
- AI skill: `packages/skills/skills/sodax-sdk/sponsoring/SKILL.md`
