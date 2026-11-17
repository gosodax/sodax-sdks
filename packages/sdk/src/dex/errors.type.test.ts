/** Pins the dex error guards (each narrows to its exact code set) and `dexInvariant` (narrows its condition). */
import { describe, expectTypeOf, it } from 'vitest';
import type { SodaxError } from '../index.js';
import { dexInvariant, isDexApproveError, isDexCreateIntentError, isDexError } from './errors.js';

describe('dex/errors', () => {
  it('guards narrow to each per-method error union', () => {
    expectTypeOf(isDexError).guards.toEqualTypeOf<SodaxError<'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'UNKNOWN'>>();
    expectTypeOf(isDexCreateIntentError).guards.toEqualTypeOf<
      SodaxError<'USER_REJECTED' | 'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isDexApproveError).guards.toEqualTypeOf<
      SodaxError<'USER_REJECTED' | 'VALIDATION_FAILED' | 'APPROVE_FAILED' | 'UNKNOWN'>
    >();
  });

  it('dexInvariant narrows its condition', () => {
    const narrowed = (value: string | null | undefined) => {
      dexInvariant(value, 'missing');
      return value;
    };
    expectTypeOf<ReturnType<typeof narrowed>>().toEqualTypeOf<string>();
  });
});
