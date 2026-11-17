/** Pins the partner error guards (each narrows to its exact code set) and `partnerInvariant` (narrows its condition). */
import { describe, expectTypeOf, it } from 'vitest';
import type { SodaxError } from '../index.js';
import { isPartnerError, partnerInvariant } from './errors.js';

describe('partner/errors', () => {
  it('guards narrow to each per-method error union', () => {
    expectTypeOf(isPartnerError).guards.toEqualTypeOf<
      SodaxError<
        'USER_REJECTED' | 'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'APPROVE_FAILED' | 'EXECUTION_FAILED' | 'UNKNOWN'
      >
    >();
  });

  it('partnerInvariant narrows its condition', () => {
    const narrowed = (value: string | null | undefined) => {
      partnerInvariant(value, 'missing');
      return value;
    };
    expectTypeOf<ReturnType<typeof narrowed>>().toEqualTypeOf<string>();
  });
});
