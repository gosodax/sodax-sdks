/** Pins the recovery error guards (each narrows to its exact code set) and `recoveryInvariant` (narrows its condition). */
import { describe, expectTypeOf, it } from 'vitest';
import type { SodaxError } from '../index.js';
import { isRecoveryError, recoveryInvariant } from './errors.js';

describe('recovery/errors', () => {
  it('guards narrow to each per-method error union', () => {
    expectTypeOf(isRecoveryError).guards.toEqualTypeOf<
      SodaxError<'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'EXECUTION_FAILED' | 'UNKNOWN'>
    >();
  });

  it('recoveryInvariant narrows its condition', () => {
    const narrowed = (value: string | null | undefined) => {
      recoveryInvariant(value, 'missing');
      return value;
    };
    expectTypeOf<ReturnType<typeof narrowed>>().toEqualTypeOf<string>();
  });
});
