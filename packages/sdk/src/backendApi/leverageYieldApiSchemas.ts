// Valibot response schemas for the backend Leverage Yield API v2.
//
// One schema per response shape declared in `@sodax/types`'s `leverageYieldApiV2.ts`.
// `LeverageYieldApiService` validates every HTTP response against these before returning
// it, so a backend contract drift surfaces as a `Result` error rather than an untyped
// runtime surprise.
//
// A leverage-yield deposit/withdraw IS an intent-based swap, so the intent-relay, gas,
// fee, and submit-tx response shapes are IDENTICAL to the swaps API. Those schemas are
// REUSED verbatim from `@sodax/swaps-api` (re-exported here for a single import site)
// rather than re-declared — the same reuse strategy the wire types use. Only the
// vault-registry and vault-read schemas are leverage-yield-specific.
//
// As in the swaps schemas, all bigint-derived fields arrive as decimal strings, so every
// such field is `v.string()`. Schemas are intentionally NOT pinned with `v.GenericSchema<…V2>`;
// type fidelity is enforced at the `LeverageYieldApiService` call sites, whose method
// returns are declared `Promise<Result<…V2>>`.

import * as v from 'valibot';

// Reused swaps schemas — the intent-relay / gas / fee / submit-tx lifecycle is shared. Sourced from
// @sodax/swaps-api, which owns the canonical swaps valibot schemas (main #254 centralized them there).
// `IntentStateSchema` is that package's name for what leverage exposes as `IntentStateResponseSchema`.
export {
  IntentResponseSchema,
  RelayExtraDataResponseSchema,
  makeCreateIntentResponseSchema,
  makeApproveResponseSchema,
  makeQuoteResponseSchema,
  makeCancelIntentResponseSchema,
  DeadlineResponseSchema,
  AllowanceCheckResponseSchema,
  SubmitIntentResponseSchema,
  StatusResponseSchema,
  IntentHashResponseSchema,
  IntentPacketResponseSchema,
  IntentStateSchema as IntentStateResponseSchema,
  GasEstimateResponseSchema,
  FeeResponseSchema,
  SubmitTxResponseSchema,
  SubmitTxStatusResponseSchema,
} from '@sodax/swaps-api';

// Per-chain raw-tx schema factory (parameterizes the create-intent / approve / quote response
// schemas). Also owned by @sodax/swaps-api; re-exported here so the service imports it from this
// single SDK-local hub rather than reaching into the package directly.
export { rawTxSchemaForChainKey } from '@sodax/swaps-api';

// ──────────────────────────────────────────────────────────────────────
// Vault registry — GET /leverage-yield/vaults · /vaults/:name
// ──────────────────────────────────────────────────────────────────────

/** Off-chain LSD staking-APR source on a vault descriptor (`LsdSourceV2`). */
export const LsdSourceSchema = v.object({
  poolId: v.string(),
  fallbackAprPct: v.number(),
  label: v.string(),
});

/** A deployed leverage-yield vault descriptor (`LeverageVaultV2`). */
const LeverageVaultSchema = v.object({
  name: v.string(),
  vault: v.string(),
  asset: v.string(),
  borrowToken: v.string(),
  lsdSource: v.optional(LsdSourceSchema),
});

/** GET /leverage-yield/vaults (`GetLeverageVaultsResponseV2`). */
export const GetLeverageVaultsResponseSchema = v.array(LeverageVaultSchema);

/** GET /leverage-yield/vaults/:name (`GetLeverageVaultResponseV2`). */
export const GetLeverageVaultResponseSchema = LeverageVaultSchema;

// ──────────────────────────────────────────────────────────────────────
// Vault reads — asset / position / APR / totals / previews / balances
// ──────────────────────────────────────────────────────────────────────

/** GET /leverage-yield/asset (`VaultAssetResponseV2`). */
export const VaultAssetResponseSchema = v.object({
  asset: v.string(),
});

/** GET /leverage-yield/position (`LeverageYieldPositionV2`) — bigint fields are decimal strings. */
export const LeverageYieldPositionSchema = v.object({
  collateral: v.string(),
  debt: v.string(),
  ltv: v.string(),
  healthFactor: v.string(),
  idleAsset: v.string(),
});

/** GET /leverage-yield/apr (`LeverageYieldAprV2`) — rates in RAY as decimal strings. */
export const LeverageYieldAprSchema = v.object({
  supplyAprRay: v.string(),
  borrowAprRay: v.string(),
  targetLtvBps: v.string(),
  leverageMultiplierWad: v.string(),
  netAprRay: v.string(),
});

/** GET /leverage-yield/apr/lsd (`LeverageYieldLsdAprV2`). */
export const LeverageYieldLsdAprSchema = v.object({
  aprRay: v.string(),
  label: v.string(),
  stale: v.boolean(),
});

/** GET /leverage-yield/apr/effective (`LeverageYieldEffectiveAprV2`) — extends the AAVE-only APR. */
export const LeverageYieldEffectiveAprSchema = v.object({
  supplyAprRay: v.string(),
  borrowAprRay: v.string(),
  targetLtvBps: v.string(),
  leverageMultiplierWad: v.string(),
  netAprRay: v.string(),
  lsdApr: LeverageYieldLsdAprSchema,
  effectiveSupplyAprRay: v.string(),
  effectiveNetAprRay: v.string(),
});

/** GET /leverage-yield/total-assets (`VaultTotalAssetsResponseV2`). */
export const VaultTotalAssetsResponseSchema = v.object({
  totalAssets: v.string(),
});

/** GET /leverage-yield/preview/deposit (`PreviewDepositResponseV2`). */
export const PreviewDepositResponseSchema = v.object({
  shares: v.string(),
});

/** GET /leverage-yield/preview/withdraw (`PreviewWithdrawResponseV2`). */
export const PreviewWithdrawResponseSchema = v.object({
  shares: v.string(),
});

/** GET /leverage-yield/preview/redeem (`PreviewRedeemResponseV2`). */
export const PreviewRedeemResponseSchema = v.object({
  assets: v.string(),
});

/** GET /leverage-yield/share-balance (`ShareBalanceResponseV2`). */
export const ShareBalanceResponseSchema = v.object({
  balance: v.string(),
});

/** GET /leverage-yield/max-withdraw (`MaxWithdrawResponseV2`). */
export const MaxWithdrawResponseSchema = v.object({
  maxWithdraw: v.string(),
});
