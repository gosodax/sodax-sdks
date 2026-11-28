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

export const stakingInvariant: FeatureInvariant = createInvariant('staking');

/** Carried on `context.action`. */
export type StakingActionType = 'stake' | 'unstake' | 'instantUnstake' | 'claim' | 'cancelUnstake';

/** `stake` is the only staking orchestrator that calls `verifyTxHash`. */
export type StakeOrchestrationErrorCode = Extract<
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

export type StakingOrchestrationErrorCode = Exclude<StakeOrchestrationErrorCode, 'TX_VERIFICATION_FAILED'>;

export type StakingCreateIntentErrorCode = CreateIntentErrorCode;
export type StakingApproveErrorCode = ApproveErrorCode;
export type StakingAllowanceCheckErrorCode = AllowanceCheckErrorCode;
export type StakingInfoFetchErrorCode = LookupErrorCode;

export type StakingErrorCode =
  | StakeOrchestrationErrorCode
  | StakingApproveErrorCode
  | StakingAllowanceCheckErrorCode
  | StakingInfoFetchErrorCode;

export type StakeOrchestrationError = SodaxError<StakeOrchestrationErrorCode>;
export type StakingOrchestrationError = SodaxError<StakingOrchestrationErrorCode>;
export type StakingCreateIntentError = SodaxError<StakingCreateIntentErrorCode>;
export type StakingApproveError = SodaxError<StakingApproveErrorCode>;
export type StakingAllowanceCheckError = SodaxError<StakingAllowanceCheckErrorCode>;
export type StakingInfoFetchError = SodaxError<StakingInfoFetchErrorCode>;
export type StakingError = SodaxError<StakingErrorCode>;

const STAKE_ORCHESTRATION_CODES: ReadonlySet<StakeOrchestrationErrorCode> = new Set([
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

const STAKING_ORCHESTRATION_CODES: ReadonlySet<StakingOrchestrationErrorCode> = new Set([
  'USER_REJECTED',
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'TX_SUBMIT_FAILED',
  'RELAY_TIMEOUT',
  'RELAY_FAILED',
  'EXECUTION_FAILED',
  'UNKNOWN',
]);

const STAKING_CODES: ReadonlySet<StakingErrorCode> = new Set<StakingErrorCode>([
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

export const isStakeOrchestrationError = isCodeMember<StakeOrchestrationErrorCode>(STAKE_ORCHESTRATION_CODES);
export const isStakingOrchestrationError = isCodeMember<StakingOrchestrationErrorCode>(STAKING_ORCHESTRATION_CODES);
export const isStakingCreateIntentError = isCodeMember<StakingCreateIntentErrorCode>(CREATE_INTENT_CODES);
export const isStakingApproveError = isCodeMember<StakingApproveErrorCode>(APPROVE_CODES);
export const isStakingAllowanceCheckError = isCodeMember<StakingAllowanceCheckErrorCode>(ALLOWANCE_CHECK_CODES);
export const isStakingInfoFetchError = isCodeMember<StakingInfoFetchErrorCode>(LOOKUP_CODES);
export const isStakingError = isCodeMember<StakingErrorCode>(STAKING_CODES);
