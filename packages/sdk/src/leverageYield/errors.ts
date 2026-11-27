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

export const leverageYieldInvariant: FeatureInvariant = createInvariant('leverageYield');

export type LeverageYieldAction =
  | 'deposit'
  | 'withdraw'
  | 'approve'
  | 'allowanceCheck'
  | 'vaultSwap'
  | 'vaultSwapWithApproval'
  | 'openPosition'
  | 'openPositionFromDebtToken'
  | 'operatePosition'
  | 'openLeveragePosition'
  | 'submitLeveragePositionIntent'
  | 'runLeveragePositionOperation'
  | 'getPositionLegQuote';

export type LeverageYieldCreateIntentErrorCode = CreateIntentErrorCode;
export type LeverageYieldApproveErrorCode = ApproveErrorCode;
export type LeverageYieldAllowanceCheckErrorCode = AllowanceCheckErrorCode;
export type LeverageYieldLookupErrorCode = LookupErrorCode;

/**
 * The only code `getDetailedStatus` returns. Prefixed because swap's unprefixed equivalent would
 * collide in the flat root `export *`.
 */
export type LeverageYieldDetailedStatusErrorCode = Extract<SodaxErrorCode, 'LOOKUP_FAILED'>;

/** Mirrors swap's `PostExecutionErrorCode`, duplicated so the leverage-yield error surface stands alone. */
export type LeverageYieldPostExecutionErrorCode = Extract<
  SodaxErrorCode,
  'EXECUTION_FAILED' | 'EXTERNAL_API_ERROR' | 'UNKNOWN'
>;

/** Create-intent codes plus verify, relay and solver-notify codes. Mirrors swap's `SwapErrorCode`. */
export type LeverageYieldSwapErrorCode = Extract<
  SodaxErrorCode,
  | 'USER_REJECTED'
  | 'VALIDATION_FAILED'
  | 'INTENT_CREATION_FAILED'
  | 'TX_VERIFICATION_FAILED'
  | 'TX_SUBMIT_FAILED'
  | 'RELAY_TIMEOUT'
  | 'RELAY_FAILED'
  | 'EXECUTION_FAILED'
  | 'EXTERNAL_API_ERROR'
  | 'UNKNOWN'
>;

export type VaultSwapWithApprovalErrorCode =
  | LeverageYieldSwapErrorCode
  | Extract<SodaxErrorCode, 'APPROVE_FAILED' | 'ALLOWANCE_CHECK_FAILED'>;

export type LeverageYieldErrorCode = Extract<
  SodaxErrorCode,
  | 'USER_REJECTED'
  | 'VALIDATION_FAILED'
  | 'INTENT_CREATION_FAILED'
  | 'APPROVE_FAILED'
  | 'ALLOWANCE_CHECK_FAILED'
  | 'LOOKUP_FAILED'
  | 'TX_VERIFICATION_FAILED'
  | 'TX_SUBMIT_FAILED'
  | 'RELAY_TIMEOUT'
  | 'RELAY_FAILED'
  | 'EXECUTION_FAILED'
  | 'EXTERNAL_API_ERROR'
  | 'UNKNOWN'
>;

export type LeverageYieldCreateIntentError = SodaxError<LeverageYieldCreateIntentErrorCode>;
export type LeverageYieldApproveError = SodaxError<LeverageYieldApproveErrorCode>;
export type LeverageYieldAllowanceCheckError = SodaxError<LeverageYieldAllowanceCheckErrorCode>;
export type LeverageYieldLookupError = SodaxError<LeverageYieldLookupErrorCode>;
export type LeverageYieldDetailedStatusError = SodaxError<LeverageYieldDetailedStatusErrorCode>;
export type LeverageYieldPostExecutionError = SodaxError<LeverageYieldPostExecutionErrorCode>;
export type LeverageYieldSwapError = SodaxError<LeverageYieldSwapErrorCode>;
export type VaultSwapWithApprovalError = SodaxError<VaultSwapWithApprovalErrorCode>;
export type LeverageYieldError = SodaxError<LeverageYieldErrorCode>;

const LEVERAGE_YIELD_CODES: ReadonlySet<LeverageYieldErrorCode> = new Set<LeverageYieldErrorCode>([
  'USER_REJECTED',
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'APPROVE_FAILED',
  'ALLOWANCE_CHECK_FAILED',
  'LOOKUP_FAILED',
  'TX_VERIFICATION_FAILED',
  'TX_SUBMIT_FAILED',
  'RELAY_TIMEOUT',
  'RELAY_FAILED',
  'EXECUTION_FAILED',
  'EXTERNAL_API_ERROR',
  'UNKNOWN',
]);

const LEVERAGE_YIELD_POST_EXECUTION_CODES: ReadonlySet<LeverageYieldPostExecutionErrorCode> = new Set([
  'EXECUTION_FAILED',
  'EXTERNAL_API_ERROR',
  'UNKNOWN',
]);

const LEVERAGE_YIELD_SWAP_CODES: ReadonlySet<LeverageYieldSwapErrorCode> = new Set([
  'USER_REJECTED',
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'TX_VERIFICATION_FAILED',
  'TX_SUBMIT_FAILED',
  'RELAY_TIMEOUT',
  'RELAY_FAILED',
  'EXECUTION_FAILED',
  'EXTERNAL_API_ERROR',
  'UNKNOWN',
]);

export const isLeverageYieldCreateIntentError = isCodeMember<LeverageYieldCreateIntentErrorCode>(CREATE_INTENT_CODES);
export const isLeverageYieldApproveError = isCodeMember<LeverageYieldApproveErrorCode>(APPROVE_CODES);
export const isLeverageYieldAllowanceCheckError =
  isCodeMember<LeverageYieldAllowanceCheckErrorCode>(ALLOWANCE_CHECK_CODES);
export const isLeverageYieldLookupError = isCodeMember<LeverageYieldLookupErrorCode>(LOOKUP_CODES);
export const isLeverageYieldPostExecutionError = isCodeMember<LeverageYieldPostExecutionErrorCode>(
  LEVERAGE_YIELD_POST_EXECUTION_CODES,
);
export const isLeverageYieldSwapError = isCodeMember<LeverageYieldSwapErrorCode>(LEVERAGE_YIELD_SWAP_CODES);
export const isVaultSwapWithApprovalError = isCodeMember<VaultSwapWithApprovalErrorCode>(
  new Set<VaultSwapWithApprovalErrorCode>([...LEVERAGE_YIELD_SWAP_CODES, 'APPROVE_FAILED', 'ALLOWANCE_CHECK_FAILED']),
);
export const isLeverageYieldError = isCodeMember<LeverageYieldErrorCode>(LEVERAGE_YIELD_CODES);
