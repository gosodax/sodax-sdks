// Intent-relay / gas / fee / submit-tx shapes are identical to swaps, so those schemas are reused from `@sodax/swaps-api`.
// Schemas aren't pinned with `v.GenericSchema<…V2>`; the service's declared return types enforce fidelity.

import * as v from 'valibot';

// `IntentStateSchema` is exposed here as `IntentStateResponseSchema`.
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

export { rawTxSchemaForChainKey } from '@sodax/swaps-api';

export const LsdSourceSchema = v.object({
  poolId: v.string(),
  fallbackAprPct: v.number(),
  label: v.string(),
});

const LeverageVaultSchema = v.object({
  name: v.string(),
  vault: v.string(),
  asset: v.string(),
  borrowToken: v.string(),
  lsdSource: v.optional(LsdSourceSchema),
});

export const GetLeverageVaultsResponseSchema = v.array(LeverageVaultSchema);

export const GetLeverageVaultResponseSchema = LeverageVaultSchema;

export const VaultAssetResponseSchema = v.object({
  asset: v.string(),
});

/** Bigint fields are decimal strings. */
export const LeverageYieldPositionSchema = v.object({
  collateral: v.string(),
  debt: v.string(),
  ltv: v.string(),
  healthFactor: v.string(),
  idleAsset: v.string(),
});

/** Rates in RAY as decimal strings. */
export const LeverageYieldAprSchema = v.object({
  supplyAprRay: v.string(),
  borrowAprRay: v.string(),
  targetLtvBps: v.string(),
  leverageMultiplierWad: v.string(),
  netAprRay: v.string(),
});

export const LeverageYieldLsdAprSchema = v.object({
  aprRay: v.string(),
  label: v.string(),
  stale: v.boolean(),
});

/** Extends the AAVE-only APR. */
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

export const VaultTotalAssetsResponseSchema = v.object({
  totalAssets: v.string(),
});

export const PreviewDepositResponseSchema = v.object({
  shares: v.string(),
});

export const PreviewWithdrawResponseSchema = v.object({
  shares: v.string(),
});

export const PreviewRedeemResponseSchema = v.object({
  assets: v.string(),
});

export const ShareBalanceResponseSchema = v.object({
  balance: v.string(),
});

export const MaxWithdrawResponseSchema = v.object({
  maxWithdraw: v.string(),
});
