import { describe, expect, it } from 'vitest';
import { ChainKeys, spokeChainConfig } from './chains.js';
import { tronSupportedTokens } from './tokens.js';

// SDK tests read Tron token addresses from this registry, so a wrong edit to it would pass them all. These are
// on-chain identities: changing one means editing it here too, on purpose.
describe('Tron token registry', () => {
  it('pins each token to its on-chain identity', () => {
    expect(tronSupportedTokens.TRX).toMatchObject({
      address: '0x0000000000000000000000000000000000000000',
      decimals: 6,
      hubAsset: '0x61cd7FFcf33E3F5EB8280b94bc5180bc617b1da9',
      vault: '0x40931ea2e572bd298c371ea4312ca58db2c3b646',
    });
    expect(tronSupportedTokens.USDT).toMatchObject({
      address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      decimals: 6,
      hubAsset: '0xA71E3e927BAf32eb5f1678a3b13c2fFfeE3973D7',
      vault: '0xbDf1F453FCB61424011BBDDCB96cFDB30f3Fe876',
    });
  });

  it('is the token set the Tron spoke config serves', () => {
    expect(spokeChainConfig[ChainKeys.TRON_MAINNET].supportedTokens).toBe(tronSupportedTokens);
  });
});
