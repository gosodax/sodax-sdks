import { describe, it, expect } from 'vitest';
import {
  ChainKeys,
  MpcRelayChainMap,
  MpcRelayPayoutMinimums,
  monadSupportedTokens,
  type MpcRelayChainKey,
  supportedTokensByChain,
  tonSupportedTokens,
  tronSupportedTokens,
  xrpSupportedTokens,
} from '../chains/index.js';
import { getEvmChainKeyByChainId, getMpcPayoutMinimum, getUnmetMpcPayoutMinimum } from './utils.js';

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
  it.each(Object.values(xrpSupportedTokens))('declares a zero floor for $symbol', token => {
    expect(MpcRelayPayoutMinimums[token.chainKey]?.[token.address]).toBe(0n);
    expect(getUnmetMpcPayoutMinimum({ token, amount: 1n })).toBeUndefined();
  });
  const { USDT: usdt, TRX: trx } = tronSupportedTokens;

  it('fails below and at the minimum, since the relay skips a release once fee >= amount', () => {
    const unmet = { symbol: 'USDT', decimals: 6, minimum: 3_000_000n };
    expect(getUnmetMpcPayoutMinimum({ token: usdt, amount: 2_999_999n })).toEqual(unmet);
    expect(getUnmetMpcPayoutMinimum({ token: usdt, amount: 3_000_000n })).toEqual(unmet);
    expect(getUnmetMpcPayoutMinimum({ token: usdt, amount: 3_000_001n })).toBeUndefined();
    expect(getUnmetMpcPayoutMinimum({ token: trx, amount: 10_000_000n })?.minimum).toBe(10_000_000n);
    expect(getUnmetMpcPayoutMinimum({ token: trx, amount: 10_000_001n })).toBeUndefined();
  });

  // A bridge form holds the source token's decimals: an 18-decimal 2 USDT must not read as huge.
  it('truncates to payout decimals before comparing the minimum', () => {
    expect(getUnmetMpcPayoutMinimum({ token: usdt, amount: 2n * 10n ** 18n, amountDecimals: 18 })).toBeDefined();
    expect(getUnmetMpcPayoutMinimum({ token: usdt, amount: 3n * 10n ** 18n, amountDecimals: 18 })).toBeDefined();
    expect(
      getUnmetMpcPayoutMinimum({ token: usdt, amount: 3_000_000_500_000_000_000n, amountDecimals: 18 }),
    ).toBeDefined();
    expect(
      getUnmetMpcPayoutMinimum({ token: usdt, amount: 3_000_001_000_000_000_000n, amountDecimals: 18 }),
    ).toBeUndefined();
  });

  // The SDK refuses a payout of a token with no floor, so a token listed without one could never be paid out.
  it('has a floor for every token of every MPC-relay chain', () => {
    const missing = (Object.keys(MpcRelayChainMap) as MpcRelayChainKey[]).flatMap(chainKey =>
      Object.values(supportedTokensByChain[chainKey])
        .filter(token => getMpcPayoutMinimum(token) === undefined)
        .map(token => `${chainKey}:${token.symbol}`),
    );
    expect(missing).toEqual([]);
  });

  it('passes a chain or token with no minimum', () => {
    expect(
      getUnmetMpcPayoutMinimum({ token: { ...usdt, chainKey: ChainKeys.ARBITRUM_MAINNET }, amount: 1n }),
    ).toBeUndefined();
    expect(getUnmetMpcPayoutMinimum({ token: { ...usdt, address: 'unlisted' }, amount: 1n })).toBeUndefined();
    expect(getUnmetMpcPayoutMinimum({ token: { ...usdt, symbol: 'OTHER' }, amount: 1n })?.minimum).toBe(3_000_000n);
  });
});

it('requires every MPC chain to declare its payout floors', () => {
  for (const key of Object.keys(MpcRelayChainMap)) {
    expect(Object.hasOwn(MpcRelayPayoutMinimums, key)).toBe(true);
  }
});

describe('Monad payout floor identity', () => {
  it('covers each Monad payout token with a zero floor independent of EVM address casing', () => {
    for (const token of Object.values(monadSupportedTokens)) {
      expect(getMpcPayoutMinimum(token)).toBe(0n);
      expect(getMpcPayoutMinimum({ ...token, address: token.address.toLowerCase() })).toBe(0n);
      expect(getMpcPayoutMinimum({ ...token, address: `0x${token.address.slice(2).toUpperCase()}` })).toBe(0n);
    }
    const { USDC } = monadSupportedTokens;
    const lower = USDC.address.toLowerCase();
    expect(USDC.address).not.toBe(lower);
    expect(getMpcPayoutMinimum({ ...USDC, address: lower })).toBe(getMpcPayoutMinimum(USDC));
    expect(getMpcPayoutMinimum({ chainKey: ChainKeys.MONAD_MAINNET, address: `0x${'ab'.repeat(20)}` })).toBeUndefined();
  });
});

it('applies the TON payout floors by token address', () => {
  const { TON, USDT } = tonSupportedTokens;
  expect(getMpcPayoutMinimum(TON)).toBe(0n);
  expect(getUnmetMpcPayoutMinimum({ token: USDT, amount: 3_000_000n })?.minimum).toBe(3_000_000n);
  expect(getUnmetMpcPayoutMinimum({ token: USDT, amount: 3_000_001n })).toBeUndefined();
});
