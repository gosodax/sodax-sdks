import { describe, it, expect } from 'vitest';
import { ChainKeys } from '../chains/index.js';
import { getEvmChainKeyByChainId, getMpcPayoutWarning } from './utils.js';

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

describe('getMpcPayoutWarning', () => {
  const usdt = { chainKey: ChainKeys.TRON_MAINNET, symbol: 'USDT', decimals: 6 };
  const trx = { chainKey: ChainKeys.TRON_MAINNET, symbol: 'TRX', decimals: 6 };

  it('warns below and at the minimum, since the relay skips a release once fee >= amount', () => {
    const warning = { symbol: 'USDT', decimals: 6, minimum: 3_000_000n };
    expect(getMpcPayoutWarning(usdt, 2_999_999n)).toEqual(warning);
    expect(getMpcPayoutWarning(usdt, 3_000_000n)).toEqual(warning);
    expect(getMpcPayoutWarning(usdt, 3_000_001n)).toBeUndefined();
    expect(getMpcPayoutWarning(trx, 10_000_000n)?.minimum).toBe(10_000_000n);
    expect(getMpcPayoutWarning(trx, 10_000_001n)).toBeUndefined();
  });

  // A bridge's amount is in the source token's decimals: an 18-decimal 2 USDT must not read as huge.
  it('compares an amount given in other decimals without rounding', () => {
    expect(getMpcPayoutWarning(usdt, 2n * 10n ** 18n, 18)).toBeDefined();
    expect(getMpcPayoutWarning(usdt, 3n * 10n ** 18n, 18)).toBeDefined();
    expect(getMpcPayoutWarning(usdt, 3n * 10n ** 18n + 1n, 18)).toBeUndefined();
  });

  it('stays silent for a chain or token with no minimum', () => {
    expect(getMpcPayoutWarning({ ...usdt, chainKey: ChainKeys.ARBITRUM_MAINNET }, 1n)).toBeUndefined();
    expect(getMpcPayoutWarning({ ...usdt, symbol: 'OTHER' }, 1n)).toBeUndefined();
  });
});
