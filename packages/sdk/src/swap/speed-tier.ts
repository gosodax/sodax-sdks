import { ChainKeys, type Address, type XToken } from '@sodax/types';

/**
 * Estimated settlement-speed bucket for a swap token pair.
 *
 * TODO: the sodax-contracts wiki (Mainnet) says "slow, normal, fast, etc." without pinning the
 * enum, so this three-label set is our reading of it. Widening it later is a breaking change for
 * consumers switching on `tier` — settle the set with the contracts team before 2.2.0 ships.
 */
export type SwapSpeedTier = 'fast' | 'normal' | 'slow';

/**
 * Rule-based estimate of how fast a src→dst swap settles, plus the tier bucket it falls into.
 * `estimatedSeconds` is the source of truth; `tier` is derived from it.
 */
export type SwapSpeedTierResult = {
  tier: SwapSpeedTier;
  estimatedSeconds: number;
};

/** Token pair to estimate a settlement-speed tier for. */
export type SwapSpeedTierParams = {
  /** Source spoke token. */
  srcToken: XToken;
  /** Destination spoke token. */
  dstToken: XToken;
};

/**
 * Hardcoded base estimates (seconds) for the rule-based speed tier.
 *
 * These are fixed rule constants — derived once from observed solver settlement
 * behavior, NOT measured at runtime. The optional future enhancement (analyzing public intents
 * data) would refine them; for the base feature they are intentionally hardcoded.
 *
 * TODO: these came from the sodax-contracts wiki (Mainnet) via #280 and have not been re-confirmed
 * against it since. Re-read that page before 2.2.0 ships; the exhaustive table in the test file
 * pins the resulting tiers, so any correction surfaces there.
 */
export const SPEED_TIER_SECONDS = {
  /** Either token's vault is a money-market-reserve (sodaAsset). */
  sodaAsset: 15,
  /** Anything else / default. */
  default: 35,
  /** Added once when either src or dst is an Ethereum asset. */
  ethereumPenalty: 10,
} as const;

/**
 * Second→tier boundaries (inclusive upper bounds).
 *
 * The rules produce exactly four totals — 15 / 25 / 35 / 45 — which these bucket as
 * fast(15) · normal(25) · slow(35, 45). That mapping is locked by the exhaustive table in
 * `speed-tier.test.ts`; the boundaries only need revisiting if the seconds above change.
 */
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
 * Pure, offline, rule-based estimate of how fast a src→dst swap will settle. Performs no
 * network or on-chain call — it classifies the pair from SDK config alone.
 *
 * @param params `{ srcToken, dstToken }` spoke token pair to classify
 * @param isSodaAssetRelated predicate answering "is this vault a money-market-reserve
 *   (sodaAsset)?". It is queried with `XToken.vault`, not `XToken.hubAsset`: the reserve set is
 *   built from `moneyMarketHubVaults` addresses, so a hub asset only matches for the Sonic vault
 *   shares themselves, where `hubAsset === vault`. In the service this is wired to
 *   `config.isMoneyMarketReserveAsset`. The predicate is injected so this function stays pure and
 *   unit-testable without a ConfigService.
 *
 * The fast 15s base applies when either token is sodaAsset-related; otherwise the base is 35s.
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
