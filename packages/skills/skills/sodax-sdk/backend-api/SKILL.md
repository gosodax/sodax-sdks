---
name: sodax-sdk-backend-api
description: 'Granular skill for the @sodax/sdk v2 BackendApiService — HTTP client to the SODAX backend for intent lookup, swap-tx submission, solver orderbook, money-market position/reserve reads, USD OHLC price candles for charts, and (internally) config fetching. Use when the task touches a backend read or write (e.g. "submit swap tx to Sodax backend", "Sodax getIntentByHash", "fetch money market position from Sodax backend", "Sodax orderbook", "Sodax price candles", "Sodax OHLC chart data", "Sodax oracle markets", "Sodax BackendApiService", "implement custom IConfigApiV1 sandbox"). Covers BOTH integration and the load-bearing v1 → v2 Result-wrapping migration. Skill links into the parent sodax-sdk knowledge tree.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Backend API (Core SDK granular skill)

Granular skill for `BackendApiService` — `sodax.backendApi`. HTTP client used by every feature for backend reads; swap-tx submission is on the sibling swaps client (`sodax.api.swaps.submitTx`). **Errors:** every method emits `feature: 'backend'` with `error.context.api: 'backend'` (the HTTP-client layer — domain tags like `'moneyMarket'` belong to the on-chain services). Data/token/MM responses are validated against valibot schemas; a contract drift returns `EXTERNAL_API_ERROR` (`context.reason: 'invalid_response_shape'`). The config/relay reads (`getAllConfig` / `getSpokeChainConfig` / `getRelayChainIdMap`) are not validated.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?** Note: v2's load-bearing change is `Result`-wrapping every method (v1 threw on failure).
2. **Which category?**
   - **Swap-related reads:** `getOrderbook`, `getIntentByHash`, `getIntentByTxHash`, `getUserIntents`. (Swap-tx submission — `sodax.api.swaps.submitTx` / `getSubmitTxStatus` — is on the swaps API client.)
   - **Money-market position reads:** `getMoneyMarketPosition`, `getAllMoneyMarketAssets`, `getMoneyMarketAsset`, `getMoneyMarketAssetBorrowers`, `getMoneyMarketAssetSuppliers`, `getAllMoneyMarketBorrowers`.
   - **Oracle price reads:** `getOracleMarkets` (quote + intervals + symbols), `getOracleCandles` (USD OHLC buckets for charting). The solver's live mark prices — `GET /v1/intent/oracle` — are a different service and have no SDK wrapper.
   - **`IConfigApiV1` interface methods (exactly 5):** `getChains`, `getSwapTokens`, `getSwapTokensByChainId`, `getMoneyMarketTokens`, `getMoneyMarketTokensByChainId`.
   - **Other `BackendApiService` config reads (NOT part of `IConfigApiV1`):** `getAllConfig`, `getMoneyMarketReserveAssets`, `getRelayChainIdMap`.
3. **Custom `IConfigApiV1` for sandbox / fixtures?** Every method must return `Promise<Result<T>>` in v2.

## Integration workflow

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md).
2. [`../integration/knowledge/features/backend-api.md`](../integration/knowledge/features/backend-api.md) — `BackendApiService` API + `sodax.api.swaps.submitTx` call shape + custom-backend pattern.
3. For the `sodax.api.swaps.submitTx` + `createIntent` flow → also load [`../swap/SKILL.md`](../swap/SKILL.md) or read [`../integration/knowledge/features/swap.md`](../integration/knowledge/features/swap.md) § "Backend submit-tx flow".
4. Errors carry `error.context.api === 'backend'` → [`../integration/knowledge/recipes/result-and-errors.md`](../integration/knowledge/recipes/result-and-errors.md) and [`../integration/knowledge/reference/error-codes.md`](../integration/knowledge/reference/error-codes.md).

### Backend-API-specific anti-patterns

- **Passing the `RelayExtraData` object** to `sodax.api.swaps.submitTx`'s `relayData`. The field is `string` — pass `relayData.payload`.
- **Using a v1 numeric `srcChainId`.** `SubmitTxRequestV2` uses `srcChainKey` (the spoke chain key string).
- **Implementing `IConfigApiV1` with throw-on-error semantics.** v2 interface requires `Promise<Result<T>>` — every method.
- **Reading money-market position from `MoneyMarketService`.** Those reads live here on `BackendApiService`.

## Migration workflow (v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md).
2. [`../migration-v1-to-v2/knowledge/features/backend-api.md`](../migration-v1-to-v2/knowledge/features/backend-api.md) — the load-bearing change: every method now returns `Promise<Result<T>>`. Includes the `submitSwapTx` request-shape changes (`srcChainId` → `srcChainKey`, `relayData` object → string) and the `IConfigApiV1` sandbox-impl change.
3. Cross-cutting `IConfigApiV1` Result-wrapping note → [`../migration-v1-to-v2/knowledge/breaking-changes/type-system.md`](../migration-v1-to-v2/knowledge/breaking-changes/type-system.md) § 6.

## Verification

1. `pnpm tsc --noEmit` clean.
2. Every `await sodax.backendApi.<method>(...)` has `if (!result.ok)`.
3. `SubmitTxRequestV2` uses `srcChainKey` and `relayData: relayData.payload` (string).
4. Any custom `IConfigApiV1` implementation returns `Promise<Result<T>>` from every method.

## Related granular skills (same family)

- [`../swap/SKILL.md`](../swap/SKILL.md) — `sodax.api.swaps.submitTx` is the backend half of the step-by-step swap flow.
- [`../swaps-api/SKILL.md`](../swaps-api/SKILL.md) — the full typed Swaps API client (`sodax.api.swaps`): quote, create-intent, submit-tx, fees, status.
- [`../money-market/SKILL.md`](../money-market/SKILL.md) — `BackendApiService` is the canonical source of MM position reads.
- [`../partner/SKILL.md`](../partner/SKILL.md), [`../recovery/SKILL.md`](../recovery/SKILL.md) — diagnostics for failures via intent / tx lookups.

For multi-feature tasks, load the broad [`sodax-sdk` skill](../SKILL.md).
