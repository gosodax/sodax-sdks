# packages/sdk

Core SODAX SDK. Entry point: `Sodax` in `src/shared/entities/Sodax.ts`.

This package must work without React, wallet-sdk-react, or dapp-kit. Backend partners, scripts, and bots can use it directly with wallet-provider implementations.

Consumer-facing AI material lives in `packages/skills`; keep this file focused on maintaining the SDK source itself.

## Architecture

- `Sodax` is the facade. It constructs feature services and shared services from one config object.
- Sonic is the hub chain. Cross-chain operations route through hub contracts and per-chain-family spoke services.
- `ConfigService` loads dynamic config from the backend and falls back to packaged defaults from `@sodax/types`.
- `SpokeService` is the runtime router for chain-family services. Feature code should call `this.spoke.getSpokeService(chainKey)` instead of constructing chain-specific providers directly.
- Wallet-provider interfaces come from `@sodax/types` via the SDK public barrel. Implementations live outside this package.

## Source Map

```text
src/
├── index.ts                 # public barrel, including @sodax/types re-exports
├── shared/                  # facade, providers, config, spoke routing, guards, utils
├── swap/                    # intent-based swaps and solver integration
├── moneyMarket/             # lending/borrowing flows and math helpers
├── bridge/                  # vault-backed cross-chain token transfers
├── staking/                 # SODA staking and unstaking flows
├── dex/                     # concentrated liquidity and DEX asset operations
├── leverageYield/           # leveraged-yield ERC-4626 vaults on the Sonic hub
├── migration/               # legacy ecosystem token migration flows
├── partner/                 # partner fee operations
├── recovery/                # hub-wallet asset recovery
├── sponsoring/              # sponsored Stellar account activation (backend pays the base reserve)
├── backendApi/              # backend API client
└── e2e-tests/               # SDK-level E2E tests
```

Detailed feature docs live in `docs/`. Read the relevant feature doc before changing public behavior.

### Links In `docs/` And `README.md`

`pnpm docs:sync-pages` generates the docs.sodax.com copy of `README.md` and most of `docs/` into the site's `docs/` tree, **moving and renaming them** on the way. `scripts/docs-pages-map.json` is the only authority for which docs publish and where each one lands — several (`SWAPS_API.md`, `SPONSORING.md`, `DEX.md`, `BRIDGE_API.md`, `ARCHITECTURE_REFACTOR_SUMMARY.md`) are not published at all.

So a relative link may only point at a doc that lands in the same destination directory under the same filename — in practice only `installation/nextjs.md`, since the how-to set is lowercased on the way out (`CONFIGURE_SDK.md` → `developers/how-to/configure_sdk.md`). Every other target needs an absolute `https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/<FILE>.md` URL (`/tree/main/` for a directory). Run `pnpm check:doc-links`; a relative link to an unpublished doc also fails `pnpm docs:sync-pages`.

## Service Pattern

Feature modules use service classes with constructor dependency injection.

- Inject shared dependencies instead of importing singletons.
- Public operations that can fail should return `Result<T>` instead of throwing.
- Treat input validation, guards, amount/decimal and address handling, and signing boundaries as correctness-critical: this is financial code, so don't weaken or bypass them, and cover changes with tests.
- Preserve chain-key-first routing: request payload chain keys drive TypeScript narrowing and runtime spoke selection.
- Use source-derived config through `ConfigService`; do not copy chain/token lists into code or agent docs.

## Errors And Results

The SDK uses `SodaxError` plus `Result<T>` for feature-level failures.

- Discriminate on `error.feature` and `error.code`.
- Use `isSodaxError(error)` for cross-bundle checks.
- Attach operation detail to `error.context` rather than adding new code variants for every method.
- Convert bigint values before JSON serialization. `SodaxError.toJSON()` already handles bigint values in context.
- Keep per-method error unions narrow when the surrounding module already follows that pattern.

When wrapping lower-level work:

```ts
const sub = await this.subOperation();
if (!sub.ok) return sub;

try {
  // feature operation
} catch (error) {
  return {
    ok: false,
    error: new SodaxError('EXECUTION_FAILED', 'Operation failed', {
      feature: 'moneyMarket',
      cause: error,
      context: { action: 'supply', phase: 'execution' },
    }),
  };
}
```

## Adding Or Changing Features

1. Start from the existing feature service nearest to the new behavior.
2. Add public types under the feature or `shared/types/` only when they are part of the SDK contract.
3. Route chain-specific behavior through `SpokeService` or an existing shared helper.
4. Keep backend request/response types JSON-safe; use strings for serialized numeric amounts.
5. Add or update unit tests beside the changed code.
6. Update a *mapped* page in `docs/` (listed in `scripts/docs-pages-map.json`) so Docs Drift passes. JSDoc and `packages/skills` do not satisfy that gate. Update `packages/skills` as well when public SDK behavior, imports, signatures, or examples changed, then run `pnpm check:ai`. A brand-new `docs/` page must be added to the map — every mapped src is published — and given its `docs/docs.json` nav entry; one not ready to go live goes on the map's `unpublished` list instead.

To scaffold a **whole new feature/service**, use the `add-feature` skill (`.claude/skills/add-feature/`) — it covers the `Sodax` facade wiring, the `src/index.ts` barrel, and the error/dapp-kit footprint.

To **add a token**, use the `add-token` skill (`.claude/skills/add-token/`); token config lives in `@sodax/types`, not here.

To **add a chain** (new spoke), use the `add-chain` skill (`.claude/skills/add-chain/`); it covers the spoke service + router here plus the cross-package steps in `@sodax/types` and the wallet packages.

## Logging

SDK diagnostics go through `SodaxLogger`, resolved from `new Sodax({ logger })`.

- Feature services should use `this.config.logger`.
- Avoid adding new direct `console.*` calls in service code.
- Keep runtime logging separate from backend config data.

## Analytics

Separate from logging: the SDK can emit **structured, opt-in user-action events** to a consumer-supplied tracker. Unlike `logger`, analytics is **off by default** and events are structured (`feature` + `action` + `phase` + `level` + `data`) rather than free-form messages.

- **Enable:** `new Sodax({ analytics: { tracker, level?, features? } })` where `tracker` is a `(event) => void` callback (e.g. `(event) => amplitude.track(event.action, event.data)`). The `analytics` option lives on `SodaxOptions` (in `@sodax/types`) next to `logger` and `fee` — client-side runtime, never on the backend-fetched `SodaxConfig`. Omit it (or pass `false`) to stay disabled.
- **Types** live in `@sodax/types` (`shared/analytics.ts`): `AnalyticsTracker`, `AnalyticsEvent`, `AnalyticsConfig`, `AnalyticsFeatures`/`AnalyticsFeatureScope`, `AnalyticsOption = AnalyticsConfig | false`. The `feature` field is `SodaxFeature` (sourced from `@sodax/types`, re-exported from `errors/codes.ts`) so analytics events and `SodaxError`s share one feature taxonomy.
- **Feature/action scoping is an allowlist.** `features` omitted → track everything. Otherwise only listed features emit: `{ swap: true, moneyMarket: { actions: ['supply','borrow'] } }` (a feature omitted from the object is OFF), or the array shorthand `['swap','moneyMarket']` (each fully tracked). `resolveAnalytics` normalizes this once into a `Map<feature, true | Set<action>>` (`null` = no scoping).
- **Resolution** lives in `shared/analytics.ts` (`resolveAnalytics`, `noopAnalytics`, `ResolvedAnalytics`), defaulting to the no-op (disabled) emitter. The resolved emitter is held on `ConfigService` (`config.analytics`, `public readonly`) **outside** the swappable `SodaxConfig`, exactly like `config.logger` and `config.fee`.
- **Emit gating** — `emit(feature, action, phase, build?, level?)` takes a **lazy thunk** invoked only when the event passes the enabled / feature+action allowlist / level gate, so payloads are never built when analytics is off or gated out. A throwing tracker is swallowed (fire-and-forget); analytics never breaks a feature flow.
- **`trackResult` is the canonical instrumentation pattern.** Each public action method wraps its own body in an inline closure: `return this.config.analytics.trackResult('<feature>', '<action>', async () => { …action body… }, { start?, success?, failure? })`. It emits `start`, runs the body, then `success`/`failure` from the returned `Result`, returning it unchanged — one boundary call covers every internal return. Keep the body in the action method (no separate `*Impl` helper); any cheap pre-computation can sit above the `trackResult` call, but the work that can fail belongs inside the closure.
- **Coverage — all features.** Every user-action flow is instrumented (action mirrors `context.action`): swap, moneyMarket (`supply`/`borrow`/`withdraw`/`repay`), bridge, staking, migration, dex, partner, recovery, leverageYield. Each `trackResult` call carries `data` builders: `start` emits the action inputs (chain keys, addresses, token(s), amount/ids — only fields present on that action's param type), `success` emits the public on-chain identifiers (tx hashes, intent/position ids), and `failure` emits `{ code: error.code }`. Builders reference the method parameter (`_params.params.<field>`) since they are siblings of the closure, and run lazily — never invoked when analytics is off or gated out. Add new fields the same way; keep amounts as `bigint` (the consumer tracker serializes).

## Build And Tests

```bash
cd packages/sdk
pnpm test
pnpm test:e2e
pnpm coverage
pnpm build
pnpm checkTs
```

The package builds dual ESM/CJS output with `tsup`. Relative imports in source use `.js` extensions.

`checkTs` typechecks test files too: `tsconfig.json` deliberately does not exclude `**/*.test.ts`,
and the shared `scripts/check-tests-typechecked.mjs` (repo root, the tail of `checkTs`) fails
loudly if a future exclude hides them again. Casts in tests follow the no-escape-hatches rule: a stub cast (`as never`,
`as unknown as …`) is allowed only while removing it breaks the typecheck — a cast that compiles
away without it is dead weight that can hide fixture drift; delete it. Every `as unknown as` in a
test also needs a one-line why-comment on or just above it — the same guard script enforces this
for new casts, with pre-existing undocumented ones grandfathered per file in
`scripts/test-cast-comment-baseline.json`, which may only shrink (`--update-baseline` regenerates it).

`build` runs `scripts/verify-dist-exports.mjs` after `tsup`, asserting every file named in
`package.json#exports` was actually emitted. `tsup` runs with `clean: true` and writes JS about ten
seconds before declarations, so a build that dies in that window leaves a `dist/` with runtime output
and no `.d.ts` — a state nothing downstream can distinguish from success, and which turbo will cache
because the task exited 0. The guard makes that exit code honest.

`pnpm check-exports` (`attw --pack`) also fails on a missing `.d.ts`, so the two overlap on symptom
but not on timing: it is a separate task that runs *after* the build, by which point turbo has
already cached the partial `dist/`. This runs inside `build`, so the bad state is never cached.

Two related rules:

- **Never import `@sodax/sdk` from inside this package.** A self-referential package import resolves
  through `exports` into `dist/`, which makes a unit test depend on a build artifact. Use the
  relative barrel (`../index.js`) — that is what every test here does.
- If a build ever *does* get cached in a partial state, the symptom is a `Failed to resolve entry for
  package` error under `pnpm test` that vanishes when you run vitest directly on the same file.
  Refresh the entry rather than chasing the test:

```bash
npx turbo build --force --filter=@sodax/sdk
```

### Backend API URLs

`api.baseURL` is the **gateway root** — origin plus the deployment's version prefix. Each service appends
its own path below it, so a base URL must never contain a service segment; folding one in relocates every
sibling service too. The composed model is documented in
[`docs/CONFIGURE_SDK.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md)
§ "How a request URL is composed".

`basePath` (`BackendApiConfig`) is the only configurable mount, because the data API's is the only one that
varies by deployment — it disappears when that service is addressed directly rather than through the
gateway. A new service puts its segment in its route strings, like `BridgeApiService` and
`SponsoringApiService` do; it does not get a config knob it has no deployment variance to justify.
Sponsoring is the one service that does **not** inherit the configured root — see `resolveSponsoringApiConfig`.
`src/backendApi/defaultApiUrls.test.ts` pins one full request URL per service from a no-config
`new Sodax()` and is the gate for all of this.

### Sponsoring Contract Gate

Where the service is mounted belongs to the deployment, not to the SDK: `SPONSORING_API_STELLAR_BASE_PATH`
is version-free (`/sponsorships/stellar`) and any `/v1` prefix lives in the configured `baseURL` —
`https://api.sodax.com/v1` (the packaged default) behind the gateway, `http://localhost:3011` for a local
service. Keep that split when touching the paths; the mock in `apps/stellar-sponsor-example` and the
contract gate below both accept either shape.

`src/sponsoring/` and `src/backendApi/SponsoringApiService.ts` talk to `apps/sponsoring-api` in the
`sodax-backend` repo, whose wire types are **hand-authored** here (in `@sodax/types`) rather than
generated — the OpenAPI document cannot express the `hash`/`alreadyActive` correlation.
`pnpm check:sponsoring-contract` (run from the repo root) asserts they still match. It is not in CI,
because CI has no sponsoring service.

It defaults to `http://localhost:3011/docs-json`, but you do **not** need a running signer — the
backend's `test/integration/openapi.spec.ts` builds the same document from mocked providers, so a
throwaway variant of it that writes `SwaggerModule.createDocument(...)` to a file gives you a spec to
pass via `--spec <path>`. That avoids booting a service that holds the real sponsor seed.

It checks the three DTOs field-by-field, the error enum, and per operation the success status plus
the declared error responses (the last one exists because an undeclared status is invisible to the
schema checks).

Treat `note:` lines as informational: a field required in the spec but optional in
`packages/types/src/backend/sponsoringApi.ts` is a shape the SDK must tolerate as absent whatever the
spec says (`SponsorErrorResponseDto.error` is the standing case — the throttler's 429 and the
exception filter's fallback both omit it), and a status the SDK classifies that the spec does not
declare is a known open item with the backend. Neither is drift. Fix real drift in the types and the
matching valibot schema in `src/backendApi/sponsoringApiSchemas.ts` — never by loosening the check.
