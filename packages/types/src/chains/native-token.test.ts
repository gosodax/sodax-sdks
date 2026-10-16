import { describe, it, expect } from 'vitest';
import type { XToken } from './tokens.js';
import { type SpokeChainKey, spokeChainConfig } from './chains.js';
import { isNativeToken } from '../utils/utils.js';

// `isNativeToken` resolves the native coin by comparing `token.address` against
// `spokeChainConfig[chainKey].nativeToken`. Every generic consumer (balance readers, deposit
// routing, gas handling) relies on that, so a chain whose `nativeToken` matches no entry in its
// own `supportedTokens` silently classifies its native coin as a contract token — the whole coin
// becomes unreadable rather than failing loudly. Pin the invariant for every chain at once so a
// newly added chain cannot reintroduce it.
describe('spokeChainConfig: nativeToken resolves to a supported token', () => {
  for (const [chainKey, config] of Object.entries(spokeChainConfig) as [
    SpokeChainKey,
    (typeof spokeChainConfig)[SpokeChainKey],
  ][]) {
    const tokens = Object.values(config.supportedTokens) as XToken[];
    const matches = tokens.filter(token => token.address.toLowerCase() === config.nativeToken.toLowerCase());

    it(`${chainKey}: exactly one supported token has address === nativeToken`, () => {
      expect(
        matches.map(t => t.symbol),
        `nativeToken '${config.nativeToken}' matched ${matches.length} of ${tokens.length} supported tokens on ${chainKey}` +
          ` (addresses: ${tokens.map(t => `${t.symbol}=${t.address}`).join(', ')})`,
      ).toHaveLength(1);
    });

    it(`${chainKey}: isNativeToken recognises it via both overloads`, () => {
      const nativeToken = matches[0];
      expect(nativeToken, `no supported token matches nativeToken on ${chainKey}`).toBeDefined();
      if (!nativeToken) return;

      expect(isNativeToken(chainKey, config.nativeToken)).toBe(true);
      expect(isNativeToken(chainKey, nativeToken)).toBe(true);
    });

    it(`${chainKey}: isNativeToken rejects the chain's non-native tokens`, () => {
      for (const token of tokens.filter(t => t.address.toLowerCase() !== config.nativeToken.toLowerCase())) {
        expect(isNativeToken(chainKey, token), `${token.symbol} (${token.address}) on ${chainKey}`).toBe(false);
      }
    });
  }
});
