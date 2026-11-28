import { spokeChainConfig, type XToken } from '@sodax/types';
import { describe, expect, it } from 'vitest';
import { Sodax } from '../index.js';
import { resolvePositionFundingAddress } from './positionFunding.js';

const sodax = new Sodax();
const HUB = sodax.hubProvider.chainConfig.chain.key;
const CHAINS = Object.keys(spokeChainConfig) as (keyof typeof spokeChainConfig)[];

/** Every supported token on every chain, which is the surface the demo's own version covered. */
const EVERY_ENTRY = CHAINS.flatMap(chainKey =>
  sodax.moneyMarket.getSupportedTokensByChainId(chainKey).map(token => ({ chainKey, token })),
);

describe('resolvePositionFundingAddress', () => {
  it('always returns an address a wallet on that chain could actually hold', () => {
    // The failure this guards is returning the hub asset for an off-hub user, or the wrapper for a
    // native one — both name a contract the signer has no balance in.
    for (const { chainKey, token } of EVERY_ENTRY) {
      const funding = resolvePositionFundingAddress(chainKey, HUB, token);
      expect(funding, `${chainKey}/${token.symbol}`).not.toBe('');
      if (chainKey !== HUB) {
        expect(funding, `${chainKey}/${token.symbol}`).toBe(token.address);
      } else {
        expect([token.address, token.hubAsset], `${chainKey}/${token.symbol}`).toContain(funding);
      }
    }
  });

  it('funds a native hub entry as NATIVE, never as its wrapper', () => {
    // Sonic's S: `address` is the zero sentinel and `hubAsset` is wS. Returning wS is the open that
    // reverted on mainnet with nothing but "External call failed".
    const natives = EVERY_ENTRY.filter(
      e => e.chainKey === HUB && e.token.address === '0x0000000000000000000000000000000000000000',
    );
    expect(natives.length).toBeGreaterThan(0);
    for (const { chainKey, token } of natives) {
      expect(resolvePositionFundingAddress(chainKey, HUB, token), token.symbol).toBe(token.address);
      expect(resolvePositionFundingAddress(chainKey, HUB, token)).not.toBe(token.hubAsset);
    }
  });

  it('rewrites a bridged hub entry to its hub asset, whose `address` would be foreign', () => {
    // Synthetic, because the registry has no such entry yet. The branch still has to be right.
    const bridged = {
      ...(EVERY_ENTRY.find(e => e.chainKey === HUB)?.token as XToken),
      address: '0x00000000000000000000000000000000000000aa',
      hubAsset: '0x00000000000000000000000000000000000000bb',
    } satisfies XToken;
    expect(resolvePositionFundingAddress(HUB, HUB, bridged)).toBe(bridged.hubAsset);
  });

  it('is total: an absent entry yields no address rather than throwing', () => {
    expect(resolvePositionFundingAddress(HUB, HUB, undefined)).toBe('');
  });
});
