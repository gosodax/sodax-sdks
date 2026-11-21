import {
  ChainKeys,
  hederaSupportedTokens,
  isRealWorldAsset,
  robinhoodSupportedTokens,
  spokeChainConfig,
  stellarSupportedTokens,
} from '@sodax/sdk';
import { describe, expect, it } from 'vitest';

// The Robinhood stocks page states these in prose; a change here means the page needs one too.
const stocks = (tokens: Record<string, { chainKey: string; address: string; decimals: number }>) =>
  Object.values(tokens).filter(isRealWorldAsset);

describe('Robinhood stocks page facts', () => {
  it.each([
    ['Robinhood Chain', robinhoodSupportedTokens, 18],
    ['Hedera', hederaSupportedTokens, 8],
    ['Stellar', stellarSupportedTokens, 7],
  ])('every stock on %s has %i decimals', (_network, tokens, decimals) => {
    const list = stocks(tokens);
    expect(list.length).toBeGreaterThan(0);
    expect(new Set(list.map(token => token.decimals))).toEqual(new Set([decimals]));
  });

  it('uses one SpokeAssetManager address on Hedera and Robinhood Chain', () => {
    const address = '0x0df73542cC68bDC01b361d231c60F726B0e0bC05';
    expect(spokeChainConfig[ChainKeys.HEDERA_MAINNET].addresses.assetManager).toBe(address);
    expect(spokeChainConfig[ChainKeys.ROBINHOOD_MAINNET].addresses.assetManager).toBe(address);
  });
});
