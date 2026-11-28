import { describe, it, expect } from 'vitest';
import { ChainKeys, type Address, type ChainKey, type XToken } from '@sodax/types';
import { estimateSwapSpeedTier, SPEED_TIER_SECONDS } from './speed-tier.js';

const SODA_VAULT = '0x1111111111111111111111111111111111111111' as Address;
const PLAIN_VAULT = '0x2222222222222222222222222222222222222222' as Address;
// Mirrors real config, where a spoke token's hubAsset differs from its vault and is never itself a
// reserve — so an estimator reading hubAsset instead of vault can never reach the fast branch.
const HUB_ASSET = '0x3333333333333333333333333333333333333333' as Address;

// Minimal XToken fixture — only the fields the speed-tier logic reads (chainKey, vault).
const token = (chainKey: ChainKey, vault: Address): XToken => ({
  symbol: 'TKN',
  name: 'Token',
  decimals: 18,
  address: '0x0000000000000000000000000000000000000000',
  chainKey,
  hubAsset: HUB_ASSET,
  vault,
});

// Predicate stand-in for config.isMoneyMarketReserveAsset, which is backed by the reserve set.
const isSodaAsset = (vault: Address): boolean => vault.toLowerCase() === SODA_VAULT.toLowerCase();

describe('estimateSwapSpeedTier', () => {
  it('either token sodaAsset-related (non-ETH) → 15s / fast', () => {
    const srcOnly = estimateSwapSpeedTier(
      { srcToken: token(ChainKeys.SONIC_MAINNET, SODA_VAULT), dstToken: token(ChainKeys.BSC_MAINNET, PLAIN_VAULT) },
      isSodaAsset,
    );
    expect(srcOnly).toEqual({ tier: 'fast', estimatedSeconds: SPEED_TIER_SECONDS.sodaAsset });

    const dstOnly = estimateSwapSpeedTier(
      { srcToken: token(ChainKeys.SONIC_MAINNET, PLAIN_VAULT), dstToken: token(ChainKeys.BSC_MAINNET, SODA_VAULT) },
      isSodaAsset,
    );
    expect(dstOnly).toEqual({ tier: 'fast', estimatedSeconds: SPEED_TIER_SECONDS.sodaAsset });
  });

  // One Ethereum leg is a row of the table below; both legs must still add the penalty only once.
  it('adds the Ethereum penalty once even when both legs are on Ethereum', () => {
    const bothEth = estimateSwapSpeedTier(
      {
        srcToken: token(ChainKeys.ETHEREUM_MAINNET, SODA_VAULT),
        dstToken: token(ChainKeys.ETHEREUM_MAINNET, SODA_VAULT),
      },
      isSodaAsset,
    );
    expect(bothEth.estimatedSeconds).toBe(SPEED_TIER_SECONDS.sodaAsset + SPEED_TIER_SECONDS.ethereumPenalty);
  });

  // The two rules are independent booleans, so these four rows are the complete output space.
  // Exact values, not arithmetic on the constants: a change to either constant must fail here and
  // be re-confirmed against the spec rather than silently recomputing the expectation.
  it('maps each sodaAsset × Ethereum combination to its exact seconds and tier', () => {
    for (const row of [
      { sodaAsset: true, ethereum: false, estimatedSeconds: 15, tier: 'fast' },
      { sodaAsset: true, ethereum: true, estimatedSeconds: 25, tier: 'normal' },
      { sodaAsset: false, ethereum: false, estimatedSeconds: 35, tier: 'slow' },
      { sodaAsset: false, ethereum: true, estimatedSeconds: 45, tier: 'slow' },
    ]) {
      const vault = row.sodaAsset ? SODA_VAULT : PLAIN_VAULT;
      const srcChain = row.ethereum ? ChainKeys.ETHEREUM_MAINNET : ChainKeys.SONIC_MAINNET;

      expect(
        estimateSwapSpeedTier(
          { srcToken: token(srcChain, vault), dstToken: token(ChainKeys.BSC_MAINNET, vault) },
          isSodaAsset,
        ),
        `sodaAsset=${row.sodaAsset} ethereum=${row.ethereum}`,
      ).toEqual({ tier: row.tier, estimatedSeconds: row.estimatedSeconds });
    }
  });
});
