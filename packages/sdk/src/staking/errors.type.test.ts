/** Pins the staking error guards (each narrows to its exact code set) and `stakingInvariant` (narrows its condition). */
import { describe, expectTypeOf, it } from 'vitest';
import type { SodaxError } from '../index.js';
import {
  isStakeOrchestrationError,
  isStakingAllowanceCheckError,
  isStakingApproveError,
  isStakingCreateIntentError,
  isStakingError,
  isStakingInfoFetchError,
  isStakingOrchestrationError,
  stakingInvariant,
} from './errors.js';

describe('staking/errors', () => {
  it('guards narrow to each per-method error union', () => {
    expectTypeOf(isStakeOrchestrationError).guards.toEqualTypeOf<
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
      >
    >();
    expectTypeOf(isStakingOrchestrationError).guards.toEqualTypeOf<
      SodaxError<
        | 'USER_REJECTED'
        | 'VALIDATION_FAILED'
        | 'INTENT_CREATION_FAILED'
        | 'TX_SUBMIT_FAILED'
        | 'RELAY_TIMEOUT'
        | 'RELAY_FAILED'
        | 'EXECUTION_FAILED'
        | 'UNKNOWN'
      >
    >();
    expectTypeOf(isStakingCreateIntentError).guards.toEqualTypeOf<
      SodaxError<'USER_REJECTED' | 'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isStakingApproveError).guards.toEqualTypeOf<
      SodaxError<'USER_REJECTED' | 'VALIDATION_FAILED' | 'APPROVE_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isStakingAllowanceCheckError).guards.toEqualTypeOf<
      SodaxError<'VALIDATION_FAILED' | 'ALLOWANCE_CHECK_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isStakingInfoFetchError).guards.toEqualTypeOf<
      SodaxError<'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isStakingError).guards.toEqualTypeOf<
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
      >
    >();
  });

  it('stakingInvariant narrows its condition', () => {
    const narrowed = (value: string | null | undefined) => {
      stakingInvariant(value, 'missing');
      return value;
    };
    expectTypeOf<ReturnType<typeof narrowed>>().toEqualTypeOf<string>();
  });
});
