/** Swap-module narrow error types. */

import { CREATE_INTENT_CODES, type CreateIntentErrorCode, type SodaxErrorCode } from '../errors/codes.js';
import { isCodeMember } from '../errors/guards.js';
import { createInvariant, type FeatureInvariant } from '../errors/invariant.js';
import type { SodaxError } from '../errors/SodaxError.js';

export const swapInvariant: FeatureInvariant = createInvariant('swap');

export type SwapAction = 'swap' | 'swapWithApproval' | 'createLimitOrder';

export type SwapCreateIntentErrorCode = CreateIntentErrorCode;

/**
 * Codes returnable by `postExecution`.
 *
 * **By design, `postExecution` alone never emits relay/verify codes** — those appear only on
 * `swap` because only `swap` orchestrates verify + relay. Do not write a unified switch
 * that handles both `postExecution` and `swap` errors expecting the same union.
 */
export type PostExecutionErrorCode = Extract<SodaxErrorCode, 'EXECUTION_FAILED' | 'EXTERNAL_API_ERROR' | 'UNKNOWN'>;

/** The only code `getDetailedStatus` returns: no status source could produce a usable answer. */
export type DetailedStatusErrorCode = Extract<SodaxErrorCode, 'LOOKUP_FAILED'>;

export type SwapErrorCode = Extract<
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

/** Codes returnable by `swapWithApproval`: every `swap` code plus the approval leg's. */
export type SwapWithApprovalErrorCode =
  | SwapErrorCode
  | Extract<SodaxErrorCode, 'APPROVE_FAILED' | 'ALLOWANCE_CHECK_FAILED'>;

/** The only code `getApprovalStrategy` returns: the allowance read failed. */
export type ApprovalStrategyErrorCode = Extract<SodaxErrorCode, 'ALLOWANCE_CHECK_FAILED'>;

export type SwapCreateIntentError = SodaxError<SwapCreateIntentErrorCode>;
export type PostExecutionError = SodaxError<PostExecutionErrorCode>;
export type SwapError = SodaxError<SwapErrorCode>;
export type DetailedStatusError = SodaxError<DetailedStatusErrorCode>;
export type SwapWithApprovalError = SodaxError<SwapWithApprovalErrorCode>;
export type ApprovalStrategyError = SodaxError<ApprovalStrategyErrorCode>;

const POST_EXECUTION_ERROR_CODES: ReadonlySet<PostExecutionErrorCode> = new Set([
  'EXECUTION_FAILED',
  'EXTERNAL_API_ERROR',
  'UNKNOWN',
]);

const SWAP_ERROR_CODES: ReadonlySet<SwapErrorCode> = new Set([
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

export const isSwapCreateIntentError = isCodeMember<SwapCreateIntentErrorCode>(CREATE_INTENT_CODES);
export const isPostExecutionError = isCodeMember<PostExecutionErrorCode>(POST_EXECUTION_ERROR_CODES);
export const isSwapError = isCodeMember<SwapErrorCode>(SWAP_ERROR_CODES);
export const isSwapWithApprovalError = isCodeMember<SwapWithApprovalErrorCode>(
  new Set<SwapWithApprovalErrorCode>([...SWAP_ERROR_CODES, 'APPROVE_FAILED', 'ALLOWANCE_CHECK_FAILED']),
);
