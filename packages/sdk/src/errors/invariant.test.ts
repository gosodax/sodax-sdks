import { describe, expect, it } from 'vitest';
import { createInvariant, sodaxInvariant, type FeatureInvariant } from './invariant.js';
import { isSodaxError, type SodaxError } from './SodaxError.js';

describe('sodaxInvariant', () => {
  it('returns silently when condition is truthy', () => {
    expect(() => sodaxInvariant(true, 'should not throw', { feature: 'swap' })).not.toThrow();
    expect(() => sodaxInvariant(1, 'should not throw', { feature: 'swap' })).not.toThrow();
    expect(() => sodaxInvariant('x', 'should not throw', { feature: 'swap' })).not.toThrow();
  });

  it('throws SodaxError<VALIDATION_FAILED> with feature, message, and phase=validate', () => {
    try {
      sodaxInvariant(false, 'amount must be > 0', { feature: 'moneyMarket', context: { field: 'amount' } });
      throw new Error('expected sodaxInvariant to throw');
    } catch (e) {
      expect(isSodaxError(e)).toBe(true);
      const err = e as SodaxError;
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.feature).toBe('moneyMarket');
      expect(err.message).toBe('amount must be > 0');
      expect(err.context?.phase).toBe('validate');
      expect(err.context?.field).toBe('amount');
    }
  });

  it('lets caller override phase if needed (still defaults to validate)', () => {
    try {
      sodaxInvariant(false, 'm', { feature: 'swap', context: { phase: 'lookup' } });
      throw new Error('expected throw');
    } catch (e) {
      expect((e as SodaxError).context?.phase).toBe('lookup');
    }
  });
});

describe('createInvariant', () => {
  it('returns a feature-bound invariant whose throws carry the bound feature', () => {
    // Explicit annotation — TS requires it to apply an `asserts` signature from a factory result.
    const swapInvariant: FeatureInvariant = createInvariant('swap');
    try {
      swapInvariant(false, 'oops', { field: 'token' });
      throw new Error('expected throw');
    } catch (e) {
      expect(isSodaxError(e)).toBe(true);
      const err = e as SodaxError;
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.feature).toBe('swap');
      expect(err.context?.field).toBe('token');
    }
  });

  it('does not throw when condition holds', () => {
    const stakingInvariant = createInvariant('staking');
    expect(() => stakingInvariant(true, 'm')).not.toThrow();
  });
});
