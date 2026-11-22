# Migration — `@sodax/sdk` v1 → v2

This tree is the v1 → v2 migration playbook for **existing consumers**. If you're starting fresh on v2 with no v1 code to port, skip to [`README.md`](../../integration/knowledge/README.md).

## What v2 changes (the 30-second version)

v2 was a deep architectural reshape, not a feature release. Five orthogonal changes account for ~95% of the breakage your typecheck will surface:

1. **Per-chain `*SpokeProvider` classes are gone.** Routing is by chain key (`srcChainKey: ChainKeys.ETHEREUM_MAINNET`). The SDK dispatches to the right per-chain spoke service internally; consumers pass `walletProvider` directly into payloads.
2. **`Result<T>` everywhere.** Every async public method on every service returns `Promise<Result<T, SodaxError<C>>>`. v1 throw-on-error patterns are gone.
3. **One canonical error class.** `SodaxError<C>` with a closed 13-code vocabulary plus `feature: 'swap' | 'moneyMarket' | …`. The per-module typed error unions (`MoneyMarketError<Code>`, `IntentError<Code>`, `StakingError<Code>`, `BridgeError<Code>`, `MigrationError<Code>`, `AssetServiceError<Code>`, `ConcentratedLiquidityError<Code>`, partner errors, …) are deleted.
4. **`WalletProviderSlot<K, Raw>` is the discriminated union.** Every signed-execution method takes `{ raw: false, walletProvider }` (chain-narrowed via `GetWalletProviderType<K>`); every raw-tx-building method takes `{ raw: true }` (no wallet provider). Compile-time enforced.
5. **`ConfigService` is the preferred lookup surface.** `hubAssets` and `*_MAINNET_CHAIN_ID` constants **are deleted** (won't compile). `moneyMarketSupportedTokens`, `SodaTokens`, `supportedSpokeChains` **are still exported** as packaged-default constants (so v1 imports keep compiling), but prefer `sodax.config.*` / `sodax.moneyMarket.getSupportedTokens*()` — those reflect your `new Sodax(config)` overrides. See [`breaking-changes/architecture.md`](breaking-changes/architecture.md) § 2 for the per-symbol table.

The remainder is per-feature (return shape diffs, field renames, new required params like `srcAddress`).

## Reading order

Read in this order. Each step builds on the last.

1. **[`ai-rules.md`](ai-rules.md)** — DO / DO NOT / workflow / stop-conditions. Read first, then dive in.
2. **This file.** Cross-cutting glossary below + reference list of breaking-changes / features / checklist.
3. **[`checklist.md`](checklist.md)** — the 17-step cross-cutting migration checklist. Walk top-down, mark items off as you go.
4. **[`breaking-changes/type-system.md`](breaking-changes/type-system.md)** — fix every import + type-level error first. Once your imports compile, the rest is tractable.
5. **[`breaking-changes/architecture.md`](breaking-changes/architecture.md)** — `*SpokeProvider` deletion, `ConfigService` replacing static lookups, relay-flow reshape, `sodaxInvariant` + per-feature aliases.
6. **[`breaking-changes/result-and-errors.md`](breaking-changes/result-and-errors.md)** — convert call-site error handling, then run the v1↔v2 error-code crosswalk.
7. **[`features/<x>.md`](features/)** — port the call sites for each feature you use. Pair with [`features/`](../../integration/knowledge/features/) (same filename) when you need the v2 design context.
8. **[`recipes.md`](recipes.md)** — codemods and adapters when full conversion in one pass isn't realistic.

## v1 ↔ v2 glossary (terms that changed meaning)

Same word, different concept across versions. Skim before reading the breaking-changes files — this dictionary prevents the most common porting confusions.

| Term | v1 meaning | v2 meaning |
|---|---|---|
| **spoke provider** | A per-chain class instance (`EvmSpokeProvider`, `SolanaSpokeProvider`, …) consumers constructed and passed into every SDK call. | A per-chain-family service inside the SDK, owned by `SpokeService` and routed to via `getSpokeService(chainKey)`. Consumers never construct one. |
| **chain id** | Numeric or string identifier varying by chain family. v1 had `*_MAINNET_CHAIN_ID` constants, often unifying as `SpokeChainId`. | A string literal from `ChainKeys.*` (the value union is `SpokeChainKey`). `ChainKeys.ICON_MAINNET` is `'0x1.icon'` (a string), not a number. |
| **error / `*Error<Code>`** | One typed-error union per module: `MoneyMarketError<MoneyMarketErrorCode>`, `IntentError<IntentErrorCode>`, etc. Discriminated by `error.code`. | One canonical class `SodaxError<C>` for all features. 13-code reason vocabulary. Discriminated by `(error.feature, error.code)`; the producing feature is a first-class field. |
| **chain narrowing** | A combination of `instanceof EvmSpokeProvider` and string equality on `chainConfig.chain.type`. | Pure type-level narrowing via `GetChainType<K>` and `GetWalletProviderType<K>` flowing from a literal `srcChainKey` generic. Runtime variant: `walletProvider.chainType === 'EVM'` (every `I*WalletProvider` declares a `readonly chainType` literal). |
| **raw tx** | An ad-hoc method on each spoke provider, sometimes named `executeXxx`, returning a chain-specific payload. | The discriminator `{ raw: true }` on the standard SDK call shape. Return type narrows via `TxReturnType<K, true>` (`EvmRawTransaction`, `SolanaRawTransaction`, …). |
| **config** | A `SodaxConfig` object passed at construction with hard-coded chain/token tables. Solver endpoints lived under `SodaxConfig.swaps`. | A `Sodax` instance owns a `ConfigService` that loads from the backend API, with packaged defaults as fallback. `sodax.config.*` is the lookup surface. **Solver endpoints moved to `SodaxConfig.solver`** (not `swaps`); `swaps` is `SwapsConfig` (supported tokens). |
| **`xChainId` field on tokens** | Field name on the `Token` type. | Renamed: `XToken.chainKey`. Type also renamed: `Token` → `XToken`. |
| **`hubAssets` / `moneyMarketSupportedTokens`** | Static `Record` global maps imported and walked. | `hubAssets` **deleted** — won't compile. `moneyMarketSupportedTokens` **still exported** as a packaged default, but prefer `sodax.config.*` and `sodax.moneyMarket.getSupportedTokens*()` so backend updates take effect. Each `XToken` now carries `vault` and `hubAsset` directly. |
| **`SubmitSwapTxRequest.srcChainId`** | Numeric chain id field on the v1 backend submit-swap request. | `srcChainKey` on `SubmitTxRequestV2`; submit-tx also moved to `sodax.api.swaps.submitTx`. |
| **`Intent.srcChain` / `Intent.dstChain`** | Read shape: `IntentRelayChainId` (bigint). | **Unchanged.** This is the relay chain id, not a spoke chain key. A blanket grep-replace `srcChain`→`srcChainKey` will break this. |
| **`AddressType`** | Bitcoin-specific address-type union. | Renamed: `BtcAddressType`. (Generic name freed up.) |

## Cross-references to integration

Every breaking-change file in this tree has a v2-design counterpart in [`sodax-sdk` (integration mode)](../../integration/knowledge/). Follow the link when "what does v2 expect instead?" comes up:

- [`breaking-changes/type-system.md`](breaking-changes/type-system.md) ↔ [`architecture.md`](../../integration/knowledge/architecture.md) (§ ChainKeys, WalletProviderSlot, Result, SodaxError) and [`reference/`](../../integration/knowledge/reference/) (chain-key + error-code tables).
- [`breaking-changes/architecture.md`](breaking-changes/architecture.md) ↔ [`architecture.md`](../../integration/knowledge/architecture.md) (§ SpokeService, Sodax facade, ConfigService, relay layer).
- [`breaking-changes/result-and-errors.md`](breaking-changes/result-and-errors.md) ↔ [`recipes/`](../../integration/knowledge/recipes/) (§ Result handling, error discrimination).
- [`features/<x>.md`](features/) ↔ [`features/`](../../integration/knowledge/features/) (same filename).
- [`recipes.md`](recipes.md) ↔ no integration counterpart (migration-only patterns).

The pair-completeness rule: every file in `migration/features/` has a sibling in `integration/features/` with the same filename. Use this when you're stuck in one and want the other view.
