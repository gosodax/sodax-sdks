import { describe, expect, it } from 'vitest';
import { ChainKeys } from './chain-keys.js';
import {
  ethereumSupportedTokens,
  isRealWorldAsset,
  robinhoodSupportedTokens,
  solanaSupportedTokens,
  supportedTokensByChain,
  type XToken,
} from './tokens.js';

describe('RWA metadata', () => {
  const equities = [
    'SPCX',
    'NVDA',
    'GME',
    'MSTR',
    'AAPL',
    'TSLA',
    'MU',
    'SNDK',
    'SPY',
    'QQQ',
    'SGOV',
    'USO',
    'SLV',
    'GOOGL',
    'AMZN',
    'MSFT',
    'META',
    'CRCL',
    'COIN',
    'PLTR',
    'TSM',
    'AMD',
    'INTC',
    'BABA',
  ];
  const xstocks = ['CRCLx', 'TSLAx', 'SPYx', 'NVDAx', 'QQQx', 'MSTRx', 'COINx', 'GOOGLx'];
  const expectedByChain: Partial<Record<string, readonly string[]>> = {
    [ChainKeys.ROBINHOOD_MAINNET]: equities,
    [ChainKeys.SONIC_MAINNET]: equities,
    [ChainKeys.STELLAR_MAINNET]: equities,
    [ChainKeys.HEDERA_MAINNET]: equities,
    [ChainKeys.SOLANA_MAINNET]: xstocks,
    [ChainKeys.ETHEREUM_MAINNET]: ['PAXG', 'XAUt'],
  };

  for (const [chainKey, entries] of Object.entries(supportedTokensByChain)) {
    it(`classifies exactly the declared RWAs on ${chainKey}`, () => {
      const tokens: readonly XToken[] = Object.values(entries);
      const expected = [...(expectedByChain[chainKey] ?? [])].sort();
      expect(
        tokens
          .filter(token => token.isRwa === true)
          .map(token => token.symbol)
          .sort(),
      ).toEqual(expected);
      expect(
        tokens
          .filter(isRealWorldAsset)
          .map(token => token.symbol)
          .sort(),
      ).toEqual(expected);
    });
  }

  it('does not infer RWA status from the chain, ticker or caller-provided flag', () => {
    for (const token of [robinhoodSupportedTokens.ETH, robinhoodSupportedTokens.SODA, robinhoodSupportedTokens.USDG]) {
      const misleadingToken = { ...token, symbol: 'AAPL', isRwa: true };
      expect(isRealWorldAsset(misleadingToken)).toBe(false);
    }
    expect(
      isRealWorldAsset({ ...robinhoodSupportedTokens.AAPL, address: '0x0000000000000000000000000000000000000001' }),
    ).toBe(false);
    expect(isRealWorldAsset({ ...robinhoodSupportedTokens.AAPL, chainKey: 'unknown' })).toBe(false);
    expect(isRealWorldAsset({ ...robinhoodSupportedTokens.AAPL, chainKey: ChainKeys.ETHEREUM_MAINNET })).toBe(false);
  });

  it('ignores symbol casing and accepts EVM address casing', () => {
    const token = ethereumSupportedTokens.PAXG;
    const lowerCaseToken = { ...token, address: token.address.toLowerCase(), symbol: 'paxg' };
    expect(isRealWorldAsset(lowerCaseToken)).toBe(true);
    expect(isRealWorldAsset({ ...token, address: token.address.toUpperCase() })).toBe(true);
    expect(isRealWorldAsset({ ...token, address: `0x${token.address.slice(2).toUpperCase()}` })).toBe(true);
    const upperCaseTicker = { ...solanaSupportedTokens.TSLAx, symbol: 'TSLAX' };
    expect(isRealWorldAsset(upperCaseTicker)).toBe(true);
  });

  it('preserves case-sensitive non-EVM identifiers', () => {
    const token = solanaSupportedTokens.TSLAx;
    expect(isRealWorldAsset(token)).toBe(true);
    expect(isRealWorldAsset({ ...token, address: token.address.toLowerCase() })).toBe(false);
  });
});
