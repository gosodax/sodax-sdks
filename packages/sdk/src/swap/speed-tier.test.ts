import { describe, it, expect } from 'vitest';
import {
  ChainKeys,
  moneyMarketReserveAssets,
  spokeChainConfig,
  type Address,
  type ChainKey,
  type XToken,
} from '@sodax/types';
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
  it('both tokens sodaAsset-related (non-ETH) → 15s / fast', () => {
    const result = estimateSwapSpeedTier(
      { srcToken: token(ChainKeys.SONIC_MAINNET, SODA_VAULT), dstToken: token(ChainKeys.BSC_MAINNET, SODA_VAULT) },
      isSodaAsset,
    );
    expect(result).toEqual({ tier: 'fast', estimatedSeconds: SPEED_TIER_SECONDS.sodaAsset });
  });

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

  it('neither token sodaAsset-related → default 35s', () => {
    const result = estimateSwapSpeedTier(
      { srcToken: token(ChainKeys.SONIC_MAINNET, PLAIN_VAULT), dstToken: token(ChainKeys.BSC_MAINNET, PLAIN_VAULT) },
      isSodaAsset,
    );
    expect(result.estimatedSeconds).toBe(SPEED_TIER_SECONDS.default);
  });

  it('adds the Ethereum penalty once when either leg is on Ethereum', () => {
    const srcEth = estimateSwapSpeedTier(
      { srcToken: token(ChainKeys.ETHEREUM_MAINNET, SODA_VAULT), dstToken: token(ChainKeys.BSC_MAINNET, SODA_VAULT) },
      isSodaAsset,
    );
    expect(srcEth.estimatedSeconds).toBe(SPEED_TIER_SECONDS.sodaAsset + SPEED_TIER_SECONDS.ethereumPenalty);

    // Both legs Ethereum — penalty still applied only once.
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
  it.each([
    { sodaAsset: true, ethereum: false, estimatedSeconds: 15, tier: 'fast' },
    { sodaAsset: true, ethereum: true, estimatedSeconds: 25, tier: 'normal' },
    { sodaAsset: false, ethereum: false, estimatedSeconds: 35, tier: 'slow' },
    { sodaAsset: false, ethereum: true, estimatedSeconds: 45, tier: 'slow' },
  ])('sodaAsset=$sodaAsset ethereum=$ethereum → $estimatedSeconds s / $tier', params => {
    const vault = params.sodaAsset ? SODA_VAULT : PLAIN_VAULT;
    const srcChain = params.ethereum ? ChainKeys.ETHEREUM_MAINNET : ChainKeys.SONIC_MAINNET;

    expect(
      estimateSwapSpeedTier(
        { srcToken: token(srcChain, vault), dstToken: token(ChainKeys.BSC_MAINNET, vault) },
        isSodaAsset,
      ),
    ).toEqual({ tier: params.tier, estimatedSeconds: params.estimatedSeconds });
  });
});

describe('estimateSwapSpeedTier against packaged config', () => {
  // The reserve set holds vault-share addresses, so querying it with hubAsset matches only the
  // Sonic vault shares — the tokens a user actually swaps would all report the slow default.
  const reserves = new Set(moneyMarketReserveAssets.map(address => address.toLowerCase()));
  const isSodaAssetRelated = (address: Address): boolean => reserves.has(address.toLowerCase());

  const soda = spokeChainConfig[ChainKeys.SONIC_MAINNET].supportedTokens.SODA;
  const sol = spokeChainConfig[ChainKeys.SOLANA_MAINNET].supportedTokens.SOL;

  it('the fixtures this suite relies on have a hubAsset distinct from their vault', () => {
    for (const config of [soda, sol]) {
      expect(config.hubAsset.toLowerCase()).not.toBe(config.vault.toLowerCase());
      expect(isSodaAssetRelated(config.vault)).toBe(true);
      expect(isSodaAssetRelated(config.hubAsset)).toBe(false);
    }
  });

  it('classifies real reserve-backed tokens as fast even though their hubAsset is not a reserve', () => {
    expect(estimateSwapSpeedTier({ srcToken: soda, dstToken: sol }, isSodaAssetRelated)).toEqual({
      tier: 'fast',
      estimatedSeconds: SPEED_TIER_SECONDS.sodaAsset,
    });
  });
});
