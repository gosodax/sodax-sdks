---
name: add-feature
description: 'Use when adding a NEW feature/service to the @sodax/sdk core — a new cross-chain DeFi capability or flow with its own <Feature>Service — as opposed to a token (add-token), a chain (add-chain), or a wallet (add-wallet-provider). The feature LOGIC is bespoke: design it from the nearest existing feature service. This skill nails the easy-to-miss cross-cutting WIRING. Triggers on "add a feature", "add a new service", "new SDK flow", "add a <X>Service to the sdk", "wire a feature into Sodax", "expose a new operation in the SDK". The optional React hook layer is packages/dapp-kit.'
---

# Adding a Feature to the SODAX SDK

> A feature's domain logic is **bespoke** — design it by starting from the nearest existing feature
> service (`swap`, `moneyMarket`, `bridge`, `staking`, `dex`, `leverageYield`, `migration`, `partner`, `recovery`).
> This skill covers the **cross-cutting wiring** that is easy to miss, not the logic. Verify each
> slot against current `src/`.

## Existing feature families — pick the closest as your template

Most "new feature" work is closest to one of the existing services in `packages/sdk/src/<feature>/`. Start from the nearest; these are existing domains, **not** separate per-feature workflows.

- **`swap`** — intent/solver flow: quote → create → cancel → post-execution; backend/solver API; token support from the `@sodax/types` swap list.
- **`bridge`** — vault-backed transfer: hub asset/vault config, bridge limits, deposit/withdraw path.
- **`moneyMarket`** — supply / borrow / repay / withdraw + collateral / liquidation; reserve + user-data services; `math-utils` / formatters; MM token + reserve wiring.
- **`staking`** — SODA stake / unstake / claim; chain support matrix.
- **`dex`** — concentrated-liquidity pool / liquidity / position / reward flows.
- **`leverageYield`** — hub-side ERC-4626 vault loop (supply → borrow → swap → re-supply); reuses the swap domain via an action-shaped vault-swap payload, derives shares to the user's hub wallet, registry in `@sodax/types`. The closest template for a new **vault / hub-only** feature.
- **`migration` · `partner` · `recovery`** — smaller, specialized templates.

> If the task is really "extend an existing feature to a new chain", "add a money-market asset", "add a bridge route", or "add a solver swap token" — that's a feature **update**, not a new service: update the owning module above, don't create a new `<Feature>Service`.

## Where a feature lives

`packages/sdk/src/<feature>/` — a self-contained module. Mirror the nearest sibling:
- `<Feature>Service.ts` — the service class. Constructor dependency injection: take `{ hubProvider, config, spoke, … }` (match what the nearest feature injects); never import singletons.
- `<Feature>Types.ts` — request/response and public contract types. Keep backend payloads JSON-safe (string amounts).
- `errors.ts` — feature-scoped errors: `createInvariant('<feature>')` plus the feature's error-code types `Extract<>`'d from the shared `SodaxErrorCode` (`src/errors/codes.ts`); add new codes there if the feature needs them.
- `index.ts` — barrel.
- `<Feature>Service.test.ts` — unit tests beside the code.
- sub-services / `math-utils` / helpers as needed (cf. `moneyMarket/`).

## Wiring (the easy-to-miss part)

1. **Facade** — `src/shared/entities/Sodax.ts`: `import { <Feature>Service } from '../../<feature>/<Feature>Service.js'`; add a `public readonly <feature>: <Feature>Service;` field; construct it in the ctor — `this.<feature> = new <Feature>Service({ hubProvider: this.hubProvider, config: this.config, spoke: this.spoke })` (match the nearest feature's deps).
2. **Public surface** — `src/index.ts`: add `export * from './<feature>/index.js';` so the feature's public types ship.
3. **Chain routing** — never construct chain providers. Route chain-specific work through `this.spoke.getSpokeService(chainKey)`. Public operations that can fail return `Result<T>` and fail via `SodaxError` — see `packages/sdk/AGENTS.md` → "Service Pattern" and "Errors And Results".

## React hook layer (only if it is a product/UI flow)

If consumers call it from React, add a `packages/dapp-kit/src/hooks/<feature>/` hook (a React-Query wrapper over the service), following the existing per-feature hook dirs (`bridge`, `mm`, `dex`, …) and `dapp-kit/AGENTS.md`. Node/backend consumers use the SDK service directly — not every feature needs a hook.

## Tests & docs
- `<Feature>Service.test.ts` for core flows, invariants, and edge cases; add an `e2e-tests/` entry if the flow is cross-chain.
- **Docs Drift CI** fails the PR unless a *related* publishable site doc changed (JSDoc is not enough). Update the matching file in `packages/sdk/docs/` that is listed in `scripts/docs-pages-map.json` (e.g. `SWAPS.md`). A brand-new page must be added to that map's `mirrored` list — every mapped src is published — and given a nav entry in `docs/docs.json`, or it is live but absent from the sidebar and search; a page not ready to go live goes on the map's `unpublished` list instead. An unrelated mapped file (for example `packages/skills/README.md`) does not satisfy an SDK source change.
- **`packages/skills` is separate** — it teaches *partner* agents how to call the public API, not how we add the feature. After the feature is wired, update the consumer skills so integrators' agents can use it, then run `pnpm check:ai`. That does not satisfy Docs Drift.

## Verify
- `cd packages/sdk && pnpm test && pnpm checkTs` (and `pnpm test:e2e` if you added a cross-chain e2e).
- Confirm the facade field + ctor wiring in `Sodax.ts` and the barrel export in `src/index.ts` — a feature that compiles but is not wired into the facade is unreachable.
