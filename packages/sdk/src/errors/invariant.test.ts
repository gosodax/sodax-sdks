import { describe, expect, it } from 'vitest';
import { createInvariant, sodaxInvariant, type FeatureInvariant } from './invariant.js';
import { isSodaxError, type SodaxError } from './SodaxError.js';

describe('sodaxInvariant', () => {
  it('returns silently when condition is truthy, and otherwise throws SodaxError<VALIDATION_FAILED> with phase=validate', () => {
    expect(() => sodaxInvariant(true, 'should not throw', { feature: 'swap' })).not.toThrow();
    expect(() => sodaxInvariant(1, 'should not throw', { feature: 'swap' })).not.toThrow();
    expect(() => sodaxInvariant('x', 'should not throw', { feature: 'swap' })).not.toThrow();
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
});

describe('createInvariant', () => {
  it('returns a feature-bound invariant that passes when the condition holds and throws with the bound feature otherwise', () => {
    // Explicit annotation — TS requires it to apply an `asserts` signature from a factory result.
    const swapInvariant: FeatureInvariant = createInvariant('swap');
    expect(() => swapInvariant(true, 'm')).not.toThrow();
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
});
