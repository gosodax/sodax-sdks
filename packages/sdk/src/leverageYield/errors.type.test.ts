/** Pins the leverageYield error guards (each narrows to its exact code set) and `leverageYieldInvariant` (narrows its condition). */
import { describe, expectTypeOf, it } from 'vitest';
import type { SodaxError } from '../index.js';
import {
  isLeverageYieldAllowanceCheckError,
  isLeverageYieldApproveError,
  isLeverageYieldCreateIntentError,
  isLeverageYieldError,
  isLeverageYieldLookupError,
  isLeverageYieldPostExecutionError,
  isLeverageYieldSwapError,
  isVaultSwapWithApprovalError,
  leverageYieldInvariant,
} from './errors.js';

describe('leverageYield/errors', () => {
  it('guards narrow to each per-method error union', () => {
    expectTypeOf(isLeverageYieldCreateIntentError).guards.toEqualTypeOf<
      SodaxError<'USER_REJECTED' | 'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isLeverageYieldApproveError).guards.toEqualTypeOf<
      SodaxError<'USER_REJECTED' | 'VALIDATION_FAILED' | 'APPROVE_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isLeverageYieldAllowanceCheckError).guards.toEqualTypeOf<
      SodaxError<'VALIDATION_FAILED' | 'ALLOWANCE_CHECK_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isLeverageYieldLookupError).guards.toEqualTypeOf<
      SodaxError<'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isLeverageYieldPostExecutionError).guards.toEqualTypeOf<
      SodaxError<'EXECUTION_FAILED' | 'EXTERNAL_API_ERROR' | 'UNKNOWN'>
    >();
    expectTypeOf(isLeverageYieldSwapError).guards.toEqualTypeOf<
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
    expectTypeOf(isVaultSwapWithApprovalError).guards.toEqualTypeOf<
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
    expectTypeOf(isLeverageYieldError).guards.toEqualTypeOf<
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
        | 'APPROVE_FAILED'
        | 'ALLOWANCE_CHECK_FAILED'
        | 'LOOKUP_FAILED'
        | 'EXTERNAL_API_ERROR'
      >
    >();
  });

  it('leverageYieldInvariant narrows its condition', () => {
    const narrowed = (value: string | null | undefined) => {
      leverageYieldInvariant(value, 'missing');
      return value;
    };
    expectTypeOf<ReturnType<typeof narrowed>>().toEqualTypeOf<string>();
  });
});
