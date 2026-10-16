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
  it('covers the whole registry, so the cases below are not a sample', () => {
    expect(EVERY_ENTRY.length).toBeGreaterThan(20);
    expect(EVERY_ENTRY.some(e => e.chainKey === HUB)).toBe(true);
  });

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

  it('LOCKS the assumption that the only hub entry needing a rewrite is the native one', () => {
    // Measured on the current registry: of 36 hub entries, exactly one has `address != hubAsset` —
    // the native S — so the bridged branch below is unexercised by real config today. Asserting the
    // branch would assert nothing; asserting the SHAPE fails the day a bridged hub entry appears,
    // which is the day this resolver needs looking at again.
    const differing = EVERY_ENTRY.filter(
      e => e.chainKey === HUB && e.token.address.toLowerCase() !== e.token.hubAsset.toLowerCase(),
    );
    expect(differing).toHaveLength(1);
    expect(differing[0]?.token.address).toBe('0x0000000000000000000000000000000000000000');
  });

  it('rewrites a bridged hub entry to its hub asset, whose `address` would be foreign', () => {
    // Synthetic, because no such entry exists yet — see above. The branch still has to be right.
    const bridged = {
      ...(EVERY_ENTRY.find(e => e.chainKey === HUB)?.token as XToken),
      address: '0x00000000000000000000000000000000000000aa',
      hubAsset: '0x00000000000000000000000000000000000000bb',
    } satisfies XToken;
    expect(resolvePositionFundingAddress(HUB, HUB, bridged)).toBe(bridged.hubAsset);
  });

  it('never returns the vault, which is the reserve and not a thing the user holds', () => {
    for (const { chainKey, token } of EVERY_ENTRY) {
      const funding = resolvePositionFundingAddress(chainKey, HUB, token).toLowerCase();
      if (token.vault.toLowerCase() === token.hubAsset.toLowerCase()) continue; // a wrapper is its own vault
      expect(funding, `${chainKey}/${token.symbol}`).not.toBe(token.vault.toLowerCase());
    }
  });

  it('is total: an absent entry yields no address rather than throwing', () => {
    expect(resolvePositionFundingAddress(HUB, HUB, undefined)).toBe('');
  });
});
