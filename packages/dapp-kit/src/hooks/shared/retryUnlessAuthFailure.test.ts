import { SodaxError } from '@sodax/sdk';
import { describe, expect, it } from 'vitest';
import { retryUnlessAuthFailure } from './retryUnlessAuthFailure.js';

/** A backend failure as the swaps API surfaces it: `EXTERNAL_API_ERROR` with the status on context. */
const apiError = (status?: number): SodaxError =>
  new SodaxError('EXTERNAL_API_ERROR', `responded with ${status}`, {
    feature: 'backend',
    context: { api: 'swaps', endpoint: '/swaps/quote', status },
  });

describe('retryUnlessAuthFailure', () => {
  it('never retries a terminal API-key rejection, even on the first attempt', () => {
    // The count check must not rescue a terminal error — order of the two conditions matters.
    for (const status of [401, 403]) {
      expect(retryUnlessAuthFailure(0, apiError(status))).toBe(false);
    }
  });

  it("retries the apiguard's transient 503 and other server failures", () => {
    // 503 is the one guard outcome that is NOT terminal — the key may be fine, verification is down.
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(retryUnlessAuthFailure(0, apiError(status))).toBe(true);
    }
  });

  it('retries failures that carry no HTTP status (network, timeout, non-SDK throws)', () => {
    expect(retryUnlessAuthFailure(0, apiError(undefined))).toBe(true);
    expect(retryUnlessAuthFailure(0, new Error('ECONNRESET'))).toBe(true);
    expect(retryUnlessAuthFailure(0, undefined)).toBe(true);
  });

  it('stops after 3 retries of a repeatable failure', () => {
    const err = apiError(500);
    expect(retryUnlessAuthFailure(2, err)).toBe(true);
    expect(retryUnlessAuthFailure(3, err)).toBe(false);
  });
});
