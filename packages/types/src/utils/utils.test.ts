import { describe, it, expect } from 'vitest';
import { ChainKeys } from '../chains/index.js';
import { getEvmChainKeyByChainId, getUnmetMpcPayoutMinimum } from './utils.js';

describe('getEvmChainKeyByChainId', () => {
  it('maps wagmi chainId 42161 to ARBITRUM_MAINNET', () => {
    expect(getEvmChainKeyByChainId(42161)).toBe(ChainKeys.ARBITRUM_MAINNET);
  });

  it('maps 1 to ETHEREUM_MAINNET', () => {
    expect(getEvmChainKeyByChainId(1)).toBe(ChainKeys.ETHEREUM_MAINNET);
  });

  it('maps 146 to SONIC_MAINNET (hub)', () => {
    expect(getEvmChainKeyByChainId(146)).toBe(ChainKeys.SONIC_MAINNET);
  });

  it('maps 8453 to BASE_MAINNET', () => {
    expect(getEvmChainKeyByChainId(8453)).toBe(ChainKeys.BASE_MAINNET);
  });

  it('maps 137 to POLYGON_MAINNET', () => {
    expect(getEvmChainKeyByChainId(137)).toBe(ChainKeys.POLYGON_MAINNET);
  });

  it('returns undefined for unknown chainId', () => {
    expect(getEvmChainKeyByChainId(999_999)).toBeUndefined();
  });

  it('returns undefined for missing chainId', () => {
    expect(getEvmChainKeyByChainId(undefined)).toBeUndefined();
  });
});

describe('getUnmetMpcPayoutMinimum', () => {
  const usdt = { chainKey: ChainKeys.TRON_MAINNET, symbol: 'USDT', decimals: 6 };
  const trx = { chainKey: ChainKeys.TRON_MAINNET, symbol: 'TRX', decimals: 6 };

  it('fails below and at the minimum, since the relay skips a release once fee >= amount', () => {
    const unmet = { symbol: 'USDT', decimals: 6, minimum: 3_000_000n, inclusive: false };
    expect(getUnmetMpcPayoutMinimum({ token: usdt, amount: 2_999_999n })).toEqual(unmet);
    expect(getUnmetMpcPayoutMinimum({ token: usdt, amount: 3_000_000n })).toEqual(unmet);
    expect(getUnmetMpcPayoutMinimum({ token: usdt, amount: 3_000_001n })).toBeUndefined();
    expect(getUnmetMpcPayoutMinimum({ token: trx, amount: 10_000_000n })?.minimum).toBe(10_000_000n);
    expect(getUnmetMpcPayoutMinimum({ token: trx, amount: 10_000_001n })).toBeUndefined();
  });

  // A bridge form holds the source token's decimals: an 18-decimal 2 USDT must not read as huge.
  it('compares an amount given in other decimals without rounding', () => {
    expect(getUnmetMpcPayoutMinimum({ token: usdt, amount: 2n * 10n ** 18n, amountDecimals: 18 })).toBeDefined();
    expect(getUnmetMpcPayoutMinimum({ token: usdt, amount: 3n * 10n ** 18n, amountDecimals: 18 })).toBeDefined();
    expect(getUnmetMpcPayoutMinimum({ token: usdt, amount: 3n * 10n ** 18n + 1n, amountDecimals: 18 })).toBeUndefined();
  });

  describe('a floor the amount may equal (Cardano)', () => {
    const ada = { chainKey: ChainKeys.CARDANO_MAINNET, symbol: 'ADA', decimals: 6 };
    const unmet = { symbol: 'ADA', decimals: 6, minimum: 1_000_000n, inclusive: true };

    it('fails below 1 ADA but passes exactly 1 ADA, which the relay releases', () => {
      expect(getUnmetMpcPayoutMinimum({ token: ada, amount: 999_999n })).toEqual(unmet);
      expect(getUnmetMpcPayoutMinimum({ token: ada, amount: 1n })).toEqual(unmet);
      expect(getUnmetMpcPayoutMinimum({ token: ada, amount: 1_000_000n })).toBeUndefined();
      expect(getUnmetMpcPayoutMinimum({ token: ada, amount: 1_000_001n })).toBeUndefined();
    });

    it('compares an amount given in other decimals without rounding', () => {
      expect(getUnmetMpcPayoutMinimum({ token: ada, amount: 10n ** 18n - 1n, amountDecimals: 18 })).toEqual(unmet);
      expect(getUnmetMpcPayoutMinimum({ token: ada, amount: 10n ** 18n, amountDecimals: 18 })).toBeUndefined();
    });
  });

  it('passes a chain or token with no minimum', () => {
    expect(
      getUnmetMpcPayoutMinimum({ token: { ...usdt, chainKey: ChainKeys.ARBITRUM_MAINNET }, amount: 1n }),
    ).toBeUndefined();
    expect(getUnmetMpcPayoutMinimum({ token: { ...usdt, symbol: 'OTHER' }, amount: 1n })).toBeUndefined();
  });
});
