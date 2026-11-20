/** Pins the bridge error guards (each narrows to its exact code set) and `bridgeInvariant` (narrows its condition). */
import { describe, expectTypeOf, it } from 'vitest';
import type { SodaxError } from '../index.js';
import {
  bridgeInvariant,
  isBridgeAllowanceCheckError,
  isBridgeApproveError,
  isBridgeCreateIntentError,
  isBridgeError,
  isBridgeLookupError,
  isBridgeOrchestrationError,
  isBridgeWithApprovalError,
} from './errors.js';

describe('bridge/errors', () => {
  it('guards narrow to each per-method error union', () => {
    expectTypeOf(isBridgeOrchestrationError).guards.toEqualTypeOf<
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
    expectTypeOf(isBridgeWithApprovalError).guards.toEqualTypeOf<
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
      >
    >();
    expectTypeOf(isBridgeCreateIntentError).guards.toEqualTypeOf<
      SodaxError<'USER_REJECTED' | 'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isBridgeApproveError).guards.toEqualTypeOf<
      SodaxError<'USER_REJECTED' | 'VALIDATION_FAILED' | 'APPROVE_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isBridgeAllowanceCheckError).guards.toEqualTypeOf<
      SodaxError<'VALIDATION_FAILED' | 'ALLOWANCE_CHECK_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isBridgeLookupError).guards.toEqualTypeOf<
      SodaxError<'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isBridgeError).guards.toEqualTypeOf<
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

  it('bridgeInvariant narrows its condition', () => {
    const narrowed = (value: string | null | undefined) => {
      bridgeInvariant(value, 'missing');
      return value;
    };
    expectTypeOf<ReturnType<typeof narrowed>>().toEqualTypeOf<string>();
  });
});
