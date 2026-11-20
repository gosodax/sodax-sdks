/** Pins each `SodaxError` constructor helper to its code, and `withErrorContext` to the code it is given. */
import { describe, expectTypeOf, it } from 'vitest';
import type { SodaxError, SodaxErrorCode } from '../index.js';
import {
  type allowanceCheckFailed,
  type approveFailed,
  type executionFailed,
  type gasEstimationFailed,
  type intentCreationFailed,
  type lookupFailed,
  type messageOf,
  type unknownFailed,
  type verifyFailed,
  withErrorContext,
} from './wrappers.js';

declare const lookupError: SodaxError<'LOOKUP_FAILED'>;
declare const approveError: SodaxError<'USER_REJECTED' | 'APPROVE_FAILED'>;
declare const anyCodeError: SodaxError;

describe('errors/wrappers', () => {
  it('fixed-code helpers return their code', () => {
    expectTypeOf<ReturnType<typeof messageOf>>().toEqualTypeOf<string>();
    expectTypeOf<ReturnType<typeof lookupFailed>>().toEqualTypeOf<SodaxError<'LOOKUP_FAILED'>>();
    expectTypeOf<ReturnType<typeof verifyFailed>>().toEqualTypeOf<SodaxError<'TX_VERIFICATION_FAILED'>>();
    expectTypeOf<ReturnType<typeof intentCreationFailed>>().toEqualTypeOf<
      SodaxError<'USER_REJECTED' | 'INTENT_CREATION_FAILED'>
    >();
    expectTypeOf<ReturnType<typeof executionFailed>>().toEqualTypeOf<SodaxError<'EXECUTION_FAILED'>>();
    expectTypeOf<ReturnType<typeof approveFailed>>().toEqualTypeOf<SodaxError<'USER_REJECTED' | 'APPROVE_FAILED'>>();
    expectTypeOf<ReturnType<typeof allowanceCheckFailed>>().toEqualTypeOf<SodaxError<'ALLOWANCE_CHECK_FAILED'>>();
    expectTypeOf<ReturnType<typeof gasEstimationFailed>>().toEqualTypeOf<SodaxError<'GAS_ESTIMATION_FAILED'>>();
    expectTypeOf<ReturnType<typeof unknownFailed>>().toEqualTypeOf<SodaxError<'UNKNOWN'>>();
  });

  it('withErrorContext keeps the code type of the error it re-issues', () => {
    const single = () => withErrorContext(lookupError, { action: 'x' });
    const union = () => withErrorContext(approveError, { action: 'x' });
    const wide = () => withErrorContext(anyCodeError, {});
    expectTypeOf<ReturnType<typeof single>>().toEqualTypeOf<SodaxError<'LOOKUP_FAILED'>>();
    expectTypeOf<ReturnType<typeof union>>().toEqualTypeOf<SodaxError<'USER_REJECTED' | 'APPROVE_FAILED'>>();
    expectTypeOf<ReturnType<typeof wide>>().toEqualTypeOf<SodaxError<SodaxErrorCode>>();
    // @ts-expect-error — only a SodaxError can be re-issued
    const invalid = () => withErrorContext(new Error('x'), {});
    expectTypeOf(invalid).toBeFunction();
  });
});
