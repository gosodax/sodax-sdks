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
    robinhoodSupportedTokens.SPCX.symbol,
    robinhoodSupportedTokens.NVDA.symbol,
    robinhoodSupportedTokens.GME.symbol,
    robinhoodSupportedTokens.MSTR.symbol,
    robinhoodSupportedTokens.AAPL.symbol,
    robinhoodSupportedTokens.TSLA.symbol,
    robinhoodSupportedTokens.MU.symbol,
    robinhoodSupportedTokens.SNDK.symbol,
    robinhoodSupportedTokens.SPY.symbol,
    robinhoodSupportedTokens.QQQ.symbol,
    robinhoodSupportedTokens.SGOV.symbol,
    robinhoodSupportedTokens.USO.symbol,
    robinhoodSupportedTokens.SLV.symbol,
    robinhoodSupportedTokens.GOOGL.symbol,
    robinhoodSupportedTokens.AMZN.symbol,
    robinhoodSupportedTokens.MSFT.symbol,
    robinhoodSupportedTokens.META.symbol,
    robinhoodSupportedTokens.CRCL.symbol,
    robinhoodSupportedTokens.COIN.symbol,
    robinhoodSupportedTokens.PLTR.symbol,
    robinhoodSupportedTokens.TSM.symbol,
    robinhoodSupportedTokens.AMD.symbol,
    robinhoodSupportedTokens.INTC.symbol,
    robinhoodSupportedTokens.BABA.symbol,
    robinhoodSupportedTokens.AMC.symbol,
    robinhoodSupportedTokens.HIMS.symbol,
    robinhoodSupportedTokens.LLY.symbol,
    robinhoodSupportedTokens.COST.symbol,
    robinhoodSupportedTokens.TTWO.symbol,
    robinhoodSupportedTokens.RBLX.symbol,
    robinhoodSupportedTokens.IBM.symbol,
    robinhoodSupportedTokens.MRNA.symbol,
    robinhoodSupportedTokens.LULU.symbol,
    robinhoodSupportedTokens.SNAP.symbol,
    robinhoodSupportedTokens.WYFI.symbol,
    robinhoodSupportedTokens.RIVN.symbol,
    robinhoodSupportedTokens.NFLX.symbol,
    robinhoodSupportedTokens.BULL.symbol,
    robinhoodSupportedTokens.QUBT.symbol,
    robinhoodSupportedTokens.NET.symbol,
    robinhoodSupportedTokens.SKHY.symbol,
    robinhoodSupportedTokens.JNJ.symbol,
    robinhoodSupportedTokens.UPS.symbol,
    robinhoodSupportedTokens.DJT.symbol,
    robinhoodSupportedTokens.RDDT.symbol,
    robinhoodSupportedTokens.GLD.symbol,
  ];
  const xstocks = [
    solanaSupportedTokens.CRCLx.symbol,
    solanaSupportedTokens.TSLAx.symbol,
    solanaSupportedTokens.SPYx.symbol,
    solanaSupportedTokens.NVDAx.symbol,
    solanaSupportedTokens.QQQx.symbol,
    solanaSupportedTokens.MSTRx.symbol,
    solanaSupportedTokens.COINx.symbol,
    solanaSupportedTokens.GOOGLx.symbol,
    solanaSupportedTokens.GLDx.symbol,
    solanaSupportedTokens.HOODx.symbol,
    solanaSupportedTokens.SPCXx.symbol,
  ];
  const expectedByChain: Partial<Record<string, readonly string[]>> = {
    [ChainKeys.ROBINHOOD_MAINNET]: equities,
    [ChainKeys.SONIC_MAINNET]: equities,
    [ChainKeys.STELLAR_MAINNET]: equities,
    [ChainKeys.HEDERA_MAINNET]: equities,
    [ChainKeys.SOLANA_MAINNET]: xstocks,
    [ChainKeys.ETHEREUM_MAINNET]: [ethereumSupportedTokens.PAXG.symbol, ethereumSupportedTokens.XAUt.symbol],
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
      const misleadingToken = { ...token, symbol: robinhoodSupportedTokens.AAPL.symbol, isRwa: true };
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
    const lowerCaseToken = { ...token, address: token.address.toLowerCase(), symbol: token.symbol.toLowerCase() };
    expect(isRealWorldAsset(lowerCaseToken)).toBe(true);
    expect(isRealWorldAsset({ ...token, address: token.address.toUpperCase() })).toBe(true);
    expect(isRealWorldAsset({ ...token, address: `0x${token.address.slice(2).toUpperCase()}` })).toBe(true);
    const xstock = solanaSupportedTokens.TSLAx;
    const upperCaseTicker = { ...xstock, symbol: xstock.symbol.toUpperCase() };
    expect(isRealWorldAsset(upperCaseTicker)).toBe(true);
  });

  it('preserves case-sensitive non-EVM identifiers', () => {
    const token = solanaSupportedTokens.TSLAx;
    expect(isRealWorldAsset(token)).toBe(true);
    expect(isRealWorldAsset({ ...token, address: token.address.toLowerCase() })).toBe(false);
  });
});
