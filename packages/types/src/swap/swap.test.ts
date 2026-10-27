import { describe, it, expect } from 'vitest';
import {
  bscSupportedTokens,
  ethereumSupportedTokens,
  SodaTokens,
  solanaSupportedTokens,
  type XToken,
} from '../chains/tokens.js';
import type { SpokeChainKey } from '../chains/chains.js';
import {
  swapSupportedTokens,
  stagingSwapSupportedTokens,
  getSupportedSolverTokens,
  getStagingSolverTokens,
  isSwapSupportedToken,
} from './swap.js';

const chainKeys = Object.keys(swapSupportedTokens) as SpokeChainKey[];

describe('assets with unavailable production routes remain staging-only', () => {
  it.each([
    solanaSupportedTokens.PRIME,
    solanaSupportedTokens.ANSEM,
    bscSupportedTokens.ADA,
    SodaTokens.sodaADA,
    ethereumSupportedTokens.wM,
  ])('$symbol on $chainKey is excluded from production', token => {
    expect(getSupportedSolverTokens(token.chainKey).map(supported => supported.address)).not.toContain(token.address);
    expect(getStagingSolverTokens(token.chainKey)).toContainEqual(token);
  });
});

describe('production and staging swap token lists are disjoint', () => {
  for (const chainKey of chainKeys) {
    it(`${chainKey}: no token appears in both lists`, () => {
      const prodAddresses = new Set(swapSupportedTokens[chainKey].map((t: XToken) => t.address.toLowerCase()));
      const overlap = stagingSwapSupportedTokens[chainKey].filter((t: XToken) =>
        prodAddresses.has(t.address.toLowerCase()),
      );
      expect(
        overlap,
        `token(s) in both production and staging lists on ${chainKey}: ${overlap.map((t: XToken) => t.symbol).join(', ')}`,
      ).toEqual([]);
    });
  }
});

describe('getSupportedSolverTokens returns the production list', () => {
  for (const chainKey of chainKeys) {
    it(`${chainKey}`, () => {
      expect(getSupportedSolverTokens(chainKey)).toEqual(swapSupportedTokens[chainKey]);
    });
  }
});

describe('getStagingSolverTokens returns production plus staging-only tokens', () => {
  for (const chainKey of chainKeys) {
    it(`${chainKey}: staging set is a superset of production`, () => {
      const staging = getStagingSolverTokens(chainKey);
      expect(staging).toEqual([...swapSupportedTokens[chainKey], ...stagingSwapSupportedTokens[chainKey]]);
    });
  }
});

describe('isSwapSupportedToken validates against the union of both environments', () => {
  for (const chainKey of chainKeys) {
    const all = [...swapSupportedTokens[chainKey], ...stagingSwapSupportedTokens[chainKey]];
    if (all.length === 0) continue;

    it(`${chainKey}: accepts every production and staging token (case-insensitive)`, () => {
      for (const token of all) {
        expect(isSwapSupportedToken(chainKey, token.address), `${token.symbol} (${token.address})`).toBe(true);
        expect(isSwapSupportedToken(chainKey, token.address.toUpperCase()), `${token.symbol} upper-cased`).toBe(true);
      }
    });
  }

  it('rejects an unknown token address', () => {
    expect(isSwapSupportedToken(chainKeys[0] as SpokeChainKey, '0x000000000000000000000000000000000000dEaD')).toBe(
      false,
    );
  });
});
