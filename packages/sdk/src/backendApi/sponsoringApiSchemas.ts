import * as v from 'valibot';

export const StellarSponsorConfigSchema = v.object({
  sponsorAccount: v.string(),
  networkPassphrase: v.string(),
  minTotalFeeStroops: v.string(),
  maxTotalFeeStroops: v.string(),
  operationCount: v.number(),
  minPerOperationFeeStroops: v.string(),
  maxPerOperationFeeStroops: v.string(),
  recommendedPerOperationFeeStroops: v.string(),
  maxTimeboundSeconds: v.number(),
  requiredStartingBalance: v.string(),
});

/** Preserves the correlation between account state and transaction hash. */
export const StellarSponsoredAccountResponseSchema = v.variant('alreadyActive', [
  v.object({ hash: v.string(), alreadyActive: v.literal(false) }),
  v.object({ hash: v.null(), alreadyActive: v.literal(true) }),
]);
