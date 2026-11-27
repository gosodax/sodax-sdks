import { ChainKeys, type Address, type XToken } from '@sodax/types';

/**
 * TODO: label set is our reading of the contracts wiki; widening it later is breaking — confirm
 * with the contracts team before 2.2.0.
 */
export type SwapSpeedTier = 'fast' | 'normal' | 'slow';

/** `estimatedSeconds` is the source of truth; `tier` is derived from it. */
export type SwapSpeedTierResult = {
  tier: SwapSpeedTier;
  estimatedSeconds: number;
};

export type SwapSpeedTierParams = {
  srcToken: XToken;
  dstToken: XToken;
};

/**
 * Fixed estimates in seconds from observed settlement, not measured at runtime.
 * TODO: re-confirm against the contracts wiki before 2.2.0; the test table pins the resulting tiers.
 */
export const SPEED_TIER_SECONDS = {
  sodaAsset: 15,
  default: 35,
  /** Added once when either side is on Ethereum. */
  ethereumPenalty: 10,
} as const;

/** Inclusive upper bounds; the rules yield only 15/25/35/45s, bucketed fast/normal/slow/slow. */
export const SPEED_TIER_THRESHOLDS = {
  fast: 20,
  normal: 30,
} as const;

const isEthereumToken = (token: XToken): boolean => token.chainKey === ChainKeys.ETHEREUM_MAINNET;

const secondsToTier = (seconds: number): SwapSpeedTier => {
  if (seconds <= SPEED_TIER_THRESHOLDS.fast) return 'fast';
  if (seconds <= SPEED_TIER_THRESHOLDS.normal) return 'normal';
  return 'slow';
};

/**
 * Offline estimate. `isSodaAssetRelated` is queried with `XToken.vault`, not `hubAsset`: the reserve set
 * is built from vault addresses, so a hub asset only matches where `hubAsset === vault`.
 */
export function estimateSwapSpeedTier(
  { srcToken, dstToken }: SwapSpeedTierParams,
  isSodaAssetRelated: (vault: Address) => boolean,
): SwapSpeedTierResult {
  const eitherSodaAsset = isSodaAssetRelated(srcToken.vault) || isSodaAssetRelated(dstToken.vault);

  let estimatedSeconds = eitherSodaAsset ? SPEED_TIER_SECONDS.sodaAsset : SPEED_TIER_SECONDS.default;

  if (isEthereumToken(srcToken) || isEthereumToken(dstToken)) {
    estimatedSeconds += SPEED_TIER_SECONDS.ethereumPenalty;
  }

  return { tier: secondsToTier(estimatedSeconds), estimatedSeconds };
}
