import { SodaxError } from '@sodax/sdk';
import { describe, expect, it } from 'vitest';
import { isUserRejectedError } from './isUserRejectedError.js';

describe('isUserRejectedError', () => {
  it('matches SodaxError with code USER_REJECTED', () => {
    const err = new SodaxError('USER_REJECTED', 'User rejected the request', { feature: 'swap' });
    expect(isUserRejectedError(err)).toBe(true);
  });

  it('does not match SodaxError with any other code', () => {
    const cases: SodaxError[] = [
      new SodaxError('INTENT_CREATION_FAILED', 'sim revert', { feature: 'swap' }),
      new SodaxError('VALIDATION_FAILED', 'user rejected by invariant', { feature: 'staking' }),
      new SodaxError('APPROVE_FAILED', 'allowance', { feature: 'moneyMarket' }),
      new SodaxError('EXECUTION_FAILED', 'orchestrator', { feature: 'bridge' }),
      new SodaxError('UNKNOWN', 'fallback', { feature: 'dex' }),
    ];
    for (const err of cases) expect(isUserRejectedError(err)).toBe(false);
  });

  it('does not match anything that is not a SodaxError, whatever its prose or shape', () => {
    // The predicate trusts SDK classification; it does NOT re-scan message content. A bare
    // Error from outside the SDK boundary (e.g. a non-canonical throw in a queryFn) is not a
    // canonical USER_REJECTED — it should fall through to the generic failure UI.
    expect(isUserRejectedError(new Error('User rejected the request'))).toBe(false);
    expect(isUserRejectedError({ name: 'UserRejectedRequestError', message: 'denied' })).toBe(false);
    expect(isUserRejectedError({ code: 4001, message: 'reject' })).toBe(false);
    expect(isUserRejectedError({ code: 'ACTION_REJECTED' })).toBe(false);
    expect(isUserRejectedError(undefined)).toBe(false);
    expect(isUserRejectedError(null)).toBe(false);
    expect(isUserRejectedError('User rejected the request')).toBe(false);
    expect(isUserRejectedError({})).toBe(false);
    expect(isUserRejectedError(0)).toBe(false);
  });
});
