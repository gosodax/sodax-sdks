/** Pins the moneyMarket error guards (each narrows to its exact code set) and `mmInvariant` (narrows its condition). */
import { describe, expectTypeOf, it } from 'vitest';
import type { SodaxError } from '../index.js';
import {
  isMoneyMarketAllowanceCheckError,
  isMoneyMarketApproveError,
  isMoneyMarketCreateIntentError,
  isMoneyMarketError,
  isMoneyMarketGasEstimationError,
  isMoneyMarketOrchestrationError,
  mmInvariant,
} from './errors.js';

describe('moneyMarket/errors', () => {
  it('guards narrow to each per-method error union', () => {
    expectTypeOf(isMoneyMarketCreateIntentError).guards.toEqualTypeOf<
      SodaxError<'USER_REJECTED' | 'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isMoneyMarketOrchestrationError).guards.toEqualTypeOf<
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
    expectTypeOf(isMoneyMarketApproveError).guards.toEqualTypeOf<
      SodaxError<'USER_REJECTED' | 'VALIDATION_FAILED' | 'APPROVE_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isMoneyMarketAllowanceCheckError).guards.toEqualTypeOf<
      SodaxError<'VALIDATION_FAILED' | 'ALLOWANCE_CHECK_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isMoneyMarketGasEstimationError).guards.toEqualTypeOf<
      SodaxError<'VALIDATION_FAILED' | 'GAS_ESTIMATION_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isMoneyMarketError).guards.toEqualTypeOf<
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
        | 'GAS_ESTIMATION_FAILED'
      >
    >();
  });

  it('mmInvariant narrows its condition', () => {
    const narrowed = (value: string | null | undefined) => {
      mmInvariant(value, 'missing');
      return value;
    };
    expectTypeOf<ReturnType<typeof narrowed>>().toEqualTypeOf<string>();
  });
});
