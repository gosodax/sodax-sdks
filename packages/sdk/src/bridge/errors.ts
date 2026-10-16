/**
 * Bridge module narrow error types.
 *
 * Single user-facing action (`'bridge'`); read-only methods emit `LOOKUP_FAILED`
 * partitioned by `context.method`.
 */

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

export const bridgeInvariant: FeatureInvariant = createInvariant('bridge');

export type BridgeAction = 'bridge';

export type BridgeOrchestrationErrorCode = Extract<
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

export type BridgeCreateIntentErrorCode = CreateIntentErrorCode;
export type BridgeApproveErrorCode = ApproveErrorCode;
export type BridgeAllowanceCheckErrorCode = AllowanceCheckErrorCode;
export type BridgeLookupErrorCode = LookupErrorCode;

/**
 * The only code `getDetailedStatus` returns: no status source could produce a usable answer.
 * Narrower than {@link BridgeLookupErrorCode}, which also admits `VALIDATION_FAILED` / `UNKNOWN`.
 */
export type BridgeDetailedStatusErrorCode = Extract<SodaxErrorCode, 'LOOKUP_FAILED'>;

export type BridgeErrorCode = Extract<
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

export type BridgeOrchestrationError = SodaxError<BridgeOrchestrationErrorCode>;
export type BridgeCreateIntentError = SodaxError<BridgeCreateIntentErrorCode>;
export type BridgeApproveError = SodaxError<BridgeApproveErrorCode>;
export type BridgeAllowanceCheckError = SodaxError<BridgeAllowanceCheckErrorCode>;
export type BridgeLookupError = SodaxError<BridgeLookupErrorCode>;
export type BridgeDetailedStatusError = SodaxError<BridgeDetailedStatusErrorCode>;
export type BridgeError = SodaxError<BridgeErrorCode>;

const ORCHESTRATION_CODES: ReadonlySet<BridgeOrchestrationErrorCode> = new Set([
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

const BRIDGE_CODES: ReadonlySet<BridgeErrorCode> = new Set<BridgeErrorCode>([
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

export const isBridgeOrchestrationError = isCodeMember<BridgeOrchestrationErrorCode>(ORCHESTRATION_CODES);
export const isBridgeCreateIntentError = isCodeMember<BridgeCreateIntentErrorCode>(CREATE_INTENT_CODES);
export const isBridgeApproveError = isCodeMember<BridgeApproveErrorCode>(APPROVE_CODES);
export const isBridgeAllowanceCheckError = isCodeMember<BridgeAllowanceCheckErrorCode>(ALLOWANCE_CHECK_CODES);
export const isBridgeLookupError = isCodeMember<BridgeLookupErrorCode>(LOOKUP_CODES);
export const isBridgeError = isCodeMember<BridgeErrorCode>(BRIDGE_CODES);
