import { describe, expect, it } from 'vitest';
import { isCodeMember, isFeatureError } from './guards.js';
import { SodaxError } from './SodaxError.js';
import type { SodaxErrorCode } from './codes.js';

describe('isFeatureError', () => {
  const isSwapError = isFeatureError('swap');
  const isMmError = isFeatureError('moneyMarket');

  it('narrows to SodaxErrors of the bound feature and rejects non-SodaxError values', () => {
    const swap = new SodaxError('VALIDATION_FAILED', 'm', { feature: 'swap' });
    const mm = new SodaxError('EXECUTION_FAILED', 'm', { feature: 'moneyMarket' });

    expect(isSwapError(swap)).toBe(true);
    expect(isSwapError(mm)).toBe(false);
    expect(isMmError(mm)).toBe(true);
    expect(isMmError(swap)).toBe(false);

    expect(isSwapError(new Error('plain'))).toBe(false);
    expect(isSwapError({ feature: 'swap' })).toBe(false);
    expect(isSwapError(null)).toBe(false);
  });
});

describe('isCodeMember', () => {
  type CreateIntentCode = Extract<SodaxErrorCode, 'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN'>;
  const CREATE_INTENT_CODES = new Set<CreateIntentCode>(['VALIDATION_FAILED', 'INTENT_CREATION_FAILED', 'UNKNOWN']);
  const isCreateIntentError = isCodeMember<CreateIntentCode>(CREATE_INTENT_CODES);

  it('returns true only for a SodaxError whose code is in the set', () => {
    expect(isCreateIntentError(new SodaxError('VALIDATION_FAILED', 'm', { feature: 'swap' }))).toBe(true);
    expect(isCreateIntentError(new SodaxError('INTENT_CREATION_FAILED', 'm', { feature: 'swap' }))).toBe(true);
    expect(isCreateIntentError(new SodaxError('RELAY_TIMEOUT', 'm', { feature: 'swap' }))).toBe(false);
    expect(isCreateIntentError(new SodaxError('EXECUTION_FAILED', 'm', { feature: 'moneyMarket' }))).toBe(false);
  });

  it('returns false for non-SodaxError values', () => {
    expect(isCreateIntentError(new Error('plain'))).toBe(false);
    expect(isCreateIntentError({ code: 'VALIDATION_FAILED' })).toBe(false);
  });
});
