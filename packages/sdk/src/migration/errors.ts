// Forward orchestrators include TX_VERIFICATION_FAILED; `revertMigrateSodaToIcx` does not.
// `migratebnUSD` carries `context.direction: 'forward' | 'reverse'`.

import {
  ALLOWANCE_CHECK_CODES,
  type AllowanceCheckErrorCode,
  APPROVE_CODES,
  type ApproveErrorCode,
  CREATE_INTENT_CODES,
  type CreateIntentErrorCode,
  LOOKUP_CODES,
  type LookupErrorCode,
  type SodaxErrorCode,
} from '../errors/codes.js';
import { isCodeMember } from '../errors/guards.js';
import { createInvariant, type FeatureInvariant } from '../errors/invariant.js';
import type { SodaxError } from '../errors/SodaxError.js';

export const migrationInvariant: FeatureInvariant = createInvariant('migration');

export type MigrationOp = 'migratebnUSD' | 'migrateIcxToSoda' | 'revertMigrateSodaToIcx' | 'migrateBaln';
export type MigrationDirection = 'forward' | 'reverse';

export type MigrateOrchestrationErrorCode = Extract<
  SodaxErrorCode,
  | 'USER_REJECTED'
  | 'VALIDATION_FAILED'
  | 'INTENT_CREATION_FAILED'
  | 'TX_VERIFICATION_FAILED'
  | 'TX_SUBMIT_FAILED'
  | 'RELAY_TIMEOUT'
  | 'RELAY_FAILED'
  | 'EXECUTION_FAILED'
  | 'UNKNOWN'
>;

export type RevertMigrationOrchestrationErrorCode = Exclude<MigrateOrchestrationErrorCode, 'TX_VERIFICATION_FAILED'>;

export type MigrationCreateIntentErrorCode = CreateIntentErrorCode;
export type MigrationApproveErrorCode = ApproveErrorCode;
export type MigrationAllowanceCheckErrorCode = AllowanceCheckErrorCode;
export type MigrationLookupErrorCode = LookupErrorCode;

export type MigrationErrorCode = Extract<
  SodaxErrorCode,
  | 'USER_REJECTED'
  | 'VALIDATION_FAILED'
  | 'INTENT_CREATION_FAILED'
  | 'TX_VERIFICATION_FAILED'
  | 'TX_SUBMIT_FAILED'
  | 'RELAY_TIMEOUT'
  | 'RELAY_FAILED'
  | 'EXECUTION_FAILED'
  | 'APPROVE_FAILED'
  | 'ALLOWANCE_CHECK_FAILED'
  | 'LOOKUP_FAILED'
  | 'UNKNOWN'
>;

export type MigrateOrchestrationError = SodaxError<MigrateOrchestrationErrorCode>;
export type RevertMigrationOrchestrationError = SodaxError<RevertMigrationOrchestrationErrorCode>;
export type MigrationCreateIntentError = SodaxError<MigrationCreateIntentErrorCode>;
export type MigrationApproveError = SodaxError<MigrationApproveErrorCode>;
export type MigrationAllowanceCheckError = SodaxError<MigrationAllowanceCheckErrorCode>;
export type MigrationLookupError = SodaxError<MigrationLookupErrorCode>;
export type MigrationError = SodaxError<MigrationErrorCode>;

const MIGRATE_ORCH_CODES: ReadonlySet<MigrateOrchestrationErrorCode> = new Set([
  'USER_REJECTED',
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'TX_VERIFICATION_FAILED',
  'TX_SUBMIT_FAILED',
  'RELAY_TIMEOUT',
  'RELAY_FAILED',
  'EXECUTION_FAILED',
  'UNKNOWN',
]);

const REVERT_ORCH_CODES: ReadonlySet<RevertMigrationOrchestrationErrorCode> = new Set([
  'USER_REJECTED',
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'TX_SUBMIT_FAILED',
  'RELAY_TIMEOUT',
  'RELAY_FAILED',
  'EXECUTION_FAILED',
  'UNKNOWN',
]);

const MIGRATION_CODES: ReadonlySet<MigrationErrorCode> = new Set<MigrationErrorCode>([
  'USER_REJECTED',
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'TX_VERIFICATION_FAILED',
  'TX_SUBMIT_FAILED',
  'RELAY_TIMEOUT',
  'RELAY_FAILED',
  'EXECUTION_FAILED',
  'APPROVE_FAILED',
  'ALLOWANCE_CHECK_FAILED',
  'LOOKUP_FAILED',
  'UNKNOWN',
]);

export const isMigrateOrchestrationError = isCodeMember<MigrateOrchestrationErrorCode>(MIGRATE_ORCH_CODES);
export const isRevertMigrationOrchestrationError =
  isCodeMember<RevertMigrationOrchestrationErrorCode>(REVERT_ORCH_CODES);
export const isMigrationCreateIntentError = isCodeMember<MigrationCreateIntentErrorCode>(CREATE_INTENT_CODES);
export const isMigrationApproveError = isCodeMember<MigrationApproveErrorCode>(APPROVE_CODES);
export const isMigrationAllowanceCheckError = isCodeMember<MigrationAllowanceCheckErrorCode>(ALLOWANCE_CHECK_CODES);
export const isMigrationLookupError = isCodeMember<MigrationLookupErrorCode>(LOOKUP_CODES);
export const isMigrationError = isCodeMember<MigrationErrorCode>(MIGRATION_CODES);
