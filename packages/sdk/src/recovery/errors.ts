import type { SodaxErrorCode } from '../errors/codes.js';
import { isCodeMember } from '../errors/guards.js';
import { createInvariant, type FeatureInvariant } from '../errors/invariant.js';
import type { SodaxError } from '../errors/SodaxError.js';

export const recoveryInvariant: FeatureInvariant = createInvariant('recovery');

export type RecoveryAction = 'withdrawHubAsset';

export type RecoveryErrorCode = Extract<
  SodaxErrorCode,
  'INTENT_CREATION_FAILED' | 'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'EXECUTION_FAILED' | 'UNKNOWN'
>;

export type RecoveryError = SodaxError<RecoveryErrorCode>;

const RECOVERY_CODES: ReadonlySet<RecoveryErrorCode> = new Set([
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'LOOKUP_FAILED',
  'EXECUTION_FAILED',
  'UNKNOWN',
]);

export const isRecoveryError = isCodeMember<RecoveryErrorCode>(RECOVERY_CODES);
