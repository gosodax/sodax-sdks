/** Pins the swap error guards (each narrows to its exact code set) and `swapInvariant` (narrows its condition). */
import { describe, expectTypeOf, it } from 'vitest';
import type { SodaxError } from '../index.js';
import {
  isPostExecutionError,
  isSwapCreateIntentError,
  isSwapError,
  isSwapWithApprovalError,
  swapInvariant,
} from './errors.js';

describe('swap/errors', () => {
  it('guards narrow to each per-method error union', () => {
    expectTypeOf(isSwapCreateIntentError).guards.toEqualTypeOf<
      SodaxError<'USER_REJECTED' | 'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isPostExecutionError).guards.toEqualTypeOf<
      SodaxError<'EXECUTION_FAILED' | 'EXTERNAL_API_ERROR' | 'UNKNOWN'>
    >();
    expectTypeOf(isSwapError).guards.toEqualTypeOf<
      SodaxError<
        | 'USER_REJECTED'
        | 'VALIDATION_FAILED'
        | 'INTENT_CREATION_FAILED'
        | 'TX_VERIFICATION_FAILED'
        | 'TX_SUBMIT_FAILED'
        | 'RELAY_TIMEOUT'
        | 'RELAY_FAILED'
        | 'EXECUTION_FAILED'
        | 'UNKNOWN'
        | 'EXTERNAL_API_ERROR'
      >
    >();
    expectTypeOf(isSwapWithApprovalError).guards.toEqualTypeOf<
      SodaxError<
        | 'USER_REJECTED'
        | 'VALIDATION_FAILED'
        | 'INTENT_CREATION_FAILED'
        | 'TX_VERIFICATION_FAILED'
        | 'TX_SUBMIT_FAILED'
        | 'RELAY_TIMEOUT'
        | 'RELAY_FAILED'
        | 'EXECUTION_FAILED'
        | 'UNKNOWN'
        | 'EXTERNAL_API_ERROR'
        | 'APPROVE_FAILED'
        | 'ALLOWANCE_CHECK_FAILED'
      >
    >();
  });

  it('swapInvariant narrows its condition', () => {
    const narrowed = (value: string | null | undefined) => {
      swapInvariant(value, 'missing');
      return value;
    };
    expectTypeOf<ReturnType<typeof narrowed>>().toEqualTypeOf<string>();
  });
});
