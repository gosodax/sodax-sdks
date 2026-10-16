# packages/types

Shared TypeScript contract layer for the SODAX monorepo. Defines chain IDs and configs, the dynamic-config shape, backend API DTOs, per-feature parameter/response shapes, wallet provider interfaces, and shared utility types.

This is the lowest layer in the dependency graph — every other package imports from here:
- `@sodax/sdk` imports and re-exports it
- `@sodax/wallet-sdk-core` and `@sodax/wallet-sdk-react` import from it
- `@sodax/dapp-kit` gets it transitively via `@sodax/sdk`

## Structure

Subdirectory-per-domain. Each subdirectory has its own `index.ts` barrel and is re-exported from the root barrel.

```
src/
├── index.ts            # Root barrel — re-exports every subdirectory
├── chains/             # Chain IDs, chain keys, chain configs
├── shared/             # Shared types used across multiple domains
├── common/             # Base types: Hex, Hash, Address, WalletAddressProvider
├── sodax-config/       # Dynamic SDK config shape (fetched from backend)
├── backend/            # Backend API request/response DTOs
├── utils/              # Helper type utilities
├── wallet/             # Generic wallet provider interfaces
│
├── evm/                # EVM wallet provider interface + raw tx/receipt types
├── solana/             # Solana wallet provider interface + tx/instruction types
├── sui/                # Sui wallet provider interface + tx/coin types
├── bitcoin/            # Bitcoin wallet provider interface + UTXO types
├── stellar/            # Stellar wallet provider interface + raw receipt types
├── injective/          # Injective wallet provider interface + execute result
├── icon/               # ICON wallet provider interface + call tx / result
├── near/               # NEAR wallet provider interface + raw tx types
├── stacks/             # Stacks wallet provider interface + Clarity / post-condition types
│
├── swap/               # Swap (intent-based solver) param/response shapes
├── moneyMarket/        # Money market param/response shapes
└── dex/                # DEX (concentrated liquidity / AMM) shapes — has dedicated sub-path export
```

## Client-side runtime options & cross-cutting tags (`shared/`)

Two `Sodax` constructor options are **client-side runtime sinks**, deliberately kept OUT of the backend-fetched data contract and instead added to `SodaxOptionalConfig` / `SodaxOptions` (`sodax-config/sodax-config.ts`) so the dynamic-config swap never overwrites them:

- `logger` ([`shared/logger.ts`](src/shared/logger.ts)) — `SodaxLogger` / `SodaxLoggerOption`. Developer diagnostics, **on by default** (`console`).
- `analytics` ([`shared/analytics.ts`](src/shared/analytics.ts)) — `AnalyticsTracker` (a `(event) => void` callback), `AnalyticsEvent` (`feature` + `action` + `phase` + `level` + `data`), `AnalyticsConfig` (`tracker` + optional `level` + `features` allowlist), `AnalyticsFeatures`/`AnalyticsFeatureScope` (the allowlist: `true` | `{ actions }` per feature, or an array shorthand; omitting `features` tracks everything), `AnalyticsOption = AnalyticsConfig | false`. Product user-action tracking, **off by default**. The SDK-side resolution + emit gating is implemented in `@sodax/sdk` (`shared/analytics.ts`), mirroring `resolveLogger`.

`SodaxFeature` ([`shared/features.ts`](src/shared/features.ts)) is the canonical list of SDK features (`swap`, `moneyMarket`, …, `leverageYield`). It lives here — the lowest layer — because both the error layer (`SodaxError.feature` in `@sodax/sdk`) and analytics depend on it; `@sodax/sdk`'s `errors/codes.ts` re-exports it (and keeps the runtime `SODAX_FEATURES` list). Add a new feature here, in one place.

## Root vs sub-path exports

Only **two** entry points are exported via [`package.json` `exports`](package.json):

- `.` — the root barrel ([`src/index.ts`](src/index.ts)) re-exports everything. This is the normal import path: `import { ChainKeys, type IEvmWalletProvider } from '@sodax/types'`.
- `./dex` — dedicated entry for DEX types: `import { … } from '@sodax/types/dex'`.

There are **no per-chain sub-path exports**. New chain types are added under the appropriate subdirectory, re-exported through that subdirectory's `index.ts`, and flow out through the root barrel automatically.

## Swap supported tokens (staging vs production)

Swap tokens live in [`src/swap/swap.ts`](src/swap/swap.ts) as two per-chain `Record<SpokeChainKey, readonly XToken[]>` lists:

- `swapSupportedTokens` — **production** solver tokens (also wired into `swapsConfig.supportedTokens`).
- `stagingSwapSupportedTokens` — tokens supported **only** in the **staging** solver environment.

The two lists are **disjoint per chain** (a token lives in exactly one). The staging solver supports the union — every production token plus the staging-only set. Accessors: `getSupportedSolverTokens` returns the production list only; `getStagingSolverTokens` returns the full staging set (production + staging-only). `isSwapSupportedToken(chainId, token)` validates against the union and does **not** gate on environment — the caller targets the correct one. Invariants (intra-list dedup, disjointness, staging-superset accessor, union validation) are enforced by [`src/chains/tokens-dedup.test.ts`](src/chains/tokens-dedup.test.ts) and [`src/swap/swap.test.ts`](src/swap/swap.test.ts). Add or move entries via the `add-token` skill (see Rules) and always confirm the target environment first.

The production list can run **ahead of the solver** — listing a token here does not make it fillable. To see where, run `pnpm check:swap-tokens-oracle` from the repo root ([`scripts/check-swap-tokens-oracle.mjs`](../../scripts/check-swap-tokens-oracle.mjs)): it reads these lists from the built package, joins them against the solver price oracle ([`GET /v1/intent/oracle`](../../docs/developers/http-api/oracle.mdx)) by `RelayChainIdMap` chain id + case-insensitive address, and exits non-zero on **EVM** drift. Non-EVM chains are reported but never failed on — oracle and SDK address formats diverge there (Sui zero-padding, Bitcoin hex, Stacks `::token` suffix), so a string match is inconclusive in both directions; confirm those with the solver team. `--staging` expects the staging set instead, but point `--oracle` at a staging endpoint that serves this payload first — none is confirmed today.

This is a manual check, not a CI gate (it depends on a live service outside this repo), and it does **not** produce the public token tables: [`docs/developers/deployments/swaps-compatible-assets.md`](../../docs/developers/deployments/swaps-compatible-assets.md) renders those live from the backend config API, which is what actually makes a token swappable.

## Hub vault feature membership (`SodaTokens`)

`SodaTokens` ([`src/chains/tokens.ts`](src/chains/tokens.ts)) is the canonical registry of Sonic hub vaults, and it grants **neither swap nor money-market support** — each of those keeps its own explicit list, so registry membership is never evidence of either. It is not inert: `sonicSupportedTokens` spreads `...SodaTokens`, so bridge / partner-fee / recovery iterate a new vault automatically like any other `supportedTokens` entry.

- **Swap** — `swapSupportedTokens[SONIC_MAINNET]` ([`src/swap/swap.ts`](src/swap/swap.ts)) names each vault as a `SodaTokens.<symbol>` reference. A vault can also be staging-only, or in no swap list at all; the inline comment there says which and why.
- **Money market** — the module-private `moneyMarketHubVaults` list ([`src/moneyMarket/moneyMarket.ts`](src/moneyMarket/moneyMarket.ts)) feeds both `moneyMarketSupportedTokens[SONIC_MAINNET]` and `moneyMarketReserveAssets`. A vault missing from it has no reserve data and cannot be lent against.

The Robinhood tokenized equities are the worked example of a swap-only vault set — deliberately in no money-market list. [`src/chains/equity-vault-tokens.test.ts`](src/chains/equity-vault-tokens.test.ts) holds the symbols and the chains they are registered on, and is the source of truth for that matrix; [`src/chains/legacy-registry-compat.test.ts`](src/chains/legacy-registry-compat.test.ts) pins every legacy registry, trustline and swap sequence literally, so an accidental reorder or a dropped entry fails there instead of in a consumer that indexes these lists; promoting a vault into a list is a deliberate edit to that fixture.

## RWA classification

`XToken.isRwa` declares tokenized stock, ETF and commodity classification in the chain
registry. Set it on each registered representation of an RWA; chain membership or
symbol patterns alone are not evidence. `isRealWorldAsset({ chainKey, address })`
resolves the packaged registry by token identity, ignoring caller-supplied labels
and flags. It does not read constructor overrides or imply feature support.
Coverage and address/casing invariants live in `src/chains/tokens-rwa.test.ts`.

## Chain logos

Each `baseChainInfo` entry carries a `logo` URL (default chain logo). The binary
files are **not** in this package — they live in [`packages/assets`](../assets/AGENTS.md)
and are served via `raw.githubusercontent.com`. `CHAIN_LOGO_BASE_URL` (exported
from [`src/chains/chains.ts`](src/chains/chains.ts)) is the directory base, and
each logo URL is `${CHAIN_LOGO_BASE_URL}/<chainKey>.png` — so the filename in
`packages/assets/chain/` must equal the `ChainKeys` value. Adding a chain logo:
drop `<chainKey>.png` in `packages/assets/chain/` and set the new entry's `logo`
to `chainLogo(ChainKeys.<NAME>)`. URL-shape invariants are covered by
[`src/chains/chains-logo.test.ts`](src/chains/chains-logo.test.ts); that the file
actually exists is covered by
[`src/chains/logo-assets.test.ts`](src/chains/logo-assets.test.ts). Consumers
(demo, web app) must read `baseChainInfo[key].logo`, not hardcode icon paths.

## Token logos

Token logos mirror chain logos but resolve by symbol instead of a stored field.
The binaries live in [`packages/assets`](../assets/AGENTS.md) under `token/` and
are served via `raw.githubusercontent.com`. `TOKEN_LOGO_BASE_URL` (exported from
[`src/chains/tokens.ts`](src/chains/tokens.ts)) is the directory base, and
`tokenLogo(symbol)` returns `${TOKEN_LOGO_BASE_URL}/${tokenLogoSlug(symbol)}.png`.
`tokenLogoSlug` lowercases the symbol and collapses non-alphanumeric runs to `-`
(so `bnUSD (legacy)` → `bnusd-legacy`), keeping filenames URL- and path-safe.
Adding a token logo: drop `<tokenLogoSlug(symbol)>.png` in `packages/assets/token/`
— no per-token config edit is needed. Invariants (URL shape, slug safety, no
slug collisions across symbols) are covered by
[`src/chains/tokens-logo.test.ts`](src/chains/tokens-logo.test.ts).

Those cover only how the URL is *built*. [`src/chains/logo-assets.test.ts`](src/chains/logo-assets.test.ts)
is the CI gate that the URL *resolves*: every token in `spokeChainConfig[*].supportedTokens`
(not just the swap / money-market ones — `BridgeService` offers destinations straight from
that map) and every `CHAIN_KEYS` entry must have a non-empty PNG under the matching name in
`packages/assets`, and no PNG may lack a claimant, which is what catches a misspelled
filename. Because `packages/assets` is not a dependency of this package, the `test` task in
[`turbo.json`](turbo.json) lists those directories in `inputs` — without that, deleting a logo
would replay a cached green run. Consumers must resolve icons with `tokenLogo(token.symbol)`,
not hardcode icon paths.

## Build

Built with `tsc` (other workspace packages bundle with tsup — this one doesn't bundle). ESM only (`"type": "module"`). Output: `dist/` with `.js` + `.d.ts` files.

`build` is `rm -rf dist && tsc`, and the `rm -rf` is load-bearing: plain `tsc` never deletes an output whose source has been removed or renamed, so a stale `.d.ts` survives every later build and gets packed into `pnpm pack:local` tarballs — where a consumer reading `node_modules` cannot distinguish a stale emit from a real export. The tsup-built packages get this from `clean: true` in their `tsup.config.ts`; this one has no bundler to do it. Published releases were never affected (CI publishes from a fresh checkout with no turbo remote cache), but local builds and local packs were.

Relative imports inside source must use `.js` extensions (see [`src/index.ts`](src/index.ts) for the pattern).

`checkTs` also typechecks test files — with a twist this package alone needs: the build tsconfig
keeps excluding `**/*.test.ts` because its `tsc` run EMITS `dist/` (tests must never land in the
published output), so a second config, `tsconfig.check.json`, extends it with tests included and
`noEmit`, and `checkTs` runs both plus the shared `scripts/check-tests-typechecked.mjs` guard
(test-in-program assert + `as unknown as` why-comment ratchet).

## Rules

- **Zero runtime dependencies.** `package.json` has no `dependencies` block — only devDependencies. Never add a runtime dependency; all types must be self-contained.
- **No re-exporting external types.** Do not import or re-export types from third-party packages (e.g. `viem`, `ethers`, `@solana/web3.js`). Define equivalent types locally so consumers don't pick up transitive type deps.
- **EVM addresses must survive `isAddress`.** A mixed-case EVM address has to carry a valid EIP-55 checksum; all-lowercase is also valid and is what hub-side fields (`hubAsset`, `vault`) use. viem rejects a bad checksum while encoding calldata, so inside a `multicall` one typo fails the whole batch and every balance in it reads zero. Enforced by [`src/chains/config-address-checksum.test.ts`](src/chains/config-address-checksum.test.ts), which walks the barrel — viem is a devDependency there, so the zero-runtime-dependency rule is unaffected. **Never re-case a non-EVM identifier** (Solana base58, Sui, Stacks, Icon, Stellar) to satisfy anything; that changes the address.
- **Prefer `import type`** wherever possible — this package should produce minimal runtime JavaScript (effectively just re-exports plus a small number of intentional runtime values, e.g. `CONFIG_VERSION`, chain key constants, Stacks enums).
- **Add new types in their subdirectory**, then re-export through that subdirectory's `index.ts`. The root `src/index.ts` already re-exports each subdirectory's barrel, so nothing more is needed for the type to be importable from `@sodax/types`.
- **Adding a token?** Use the `add-token` skill (`.claude/skills/add-token/`) — it has the verified end-to-end procedure (which chain map and feature lists to touch, the payload→`XToken` field mapping, and what is auto-handled). Do not wire token config ad hoc. Docs Drift requires a mapped `packages/sdk/docs/` feature page (`SWAPS.md` / `MONEY_MARKET.md`) alongside `src/` changes; `packages/types/README.md` passes the gate but does not publish.
- **Adding a chain?** Use the `add-chain` skill (`.claude/skills/add-chain/`) — it orchestrates the cross-package footprint that starts here (chain key, config, types, wallet interface) and continues into the sdk spoke and the wallet packages.
- **`CONFIG_VERSION` is derived, not incremented** ([`src/index.ts`](src/index.ts)): never edit it by hand — `scripts/bump-versions.sh` derives it from this package's `version` (`major * 1e6 + minor * 1e4 + patch * 100 + (rc ?? 99)`), so it is a pure function of the manifest. The invariant is asserted from both sides: `scripts/config-version.test.mjs` and [`src/config-version.test.ts`](src/config-version.test.ts). `scripts/config-version.mjs` mirrors the formula for release time, which runs before any build — change one and you must change the other. Consumers (notably `@sodax/sdk`'s `ConfigService`) compare it against the backend's `version` to detect SDK↔API drift; the API serves this same constant from the SDK release it has installed.
- **All wallet provider interfaces extend `WalletAddressProvider`** from `common/`.
- **No `any`.** Use `unknown` where the type cannot be known statically.
