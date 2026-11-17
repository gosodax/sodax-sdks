/** Pins the migration error guards (each narrows to its exact code set) and `migrationInvariant` (narrows its condition). */
import { describe, expectTypeOf, it } from 'vitest';
import type { SodaxError } from '../index.js';
import {
  isMigrateOrchestrationError,
  isMigrationAllowanceCheckError,
  isMigrationApproveError,
  isMigrationCreateIntentError,
  isMigrationError,
  isMigrationLookupError,
  isRevertMigrationOrchestrationError,
  migrationInvariant,
} from './errors.js';

describe('migration/errors', () => {
  it('guards narrow to each per-method error union', () => {
    expectTypeOf(isMigrateOrchestrationError).guards.toEqualTypeOf<
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
    expectTypeOf(isRevertMigrationOrchestrationError).guards.toEqualTypeOf<
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
    expectTypeOf(isMigrationCreateIntentError).guards.toEqualTypeOf<
      SodaxError<'USER_REJECTED' | 'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isMigrationApproveError).guards.toEqualTypeOf<
      SodaxError<'USER_REJECTED' | 'VALIDATION_FAILED' | 'APPROVE_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isMigrationAllowanceCheckError).guards.toEqualTypeOf<
      SodaxError<'VALIDATION_FAILED' | 'ALLOWANCE_CHECK_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isMigrationLookupError).guards.toEqualTypeOf<
      SodaxError<'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isMigrationError).guards.toEqualTypeOf<
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

  it('migrationInvariant narrows its condition', () => {
    const narrowed = (value: string | null | undefined) => {
      migrationInvariant(value, 'missing');
      return value;
    };
    expectTypeOf<ReturnType<typeof narrowed>>().toEqualTypeOf<string>();
  });
});
