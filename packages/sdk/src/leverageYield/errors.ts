/**
 * leverageYield module narrow error types.
 *
 * The service owns the full vault-swap lifecycle: `deposit` / `withdraw` build
 * `CreateIntentParams`, `createVaultIntent` submits the intent on the source spoke chain,
 * and `vaultSwap` orchestrates the end-to-end flow (create → verify → relay → notify
 * solver). `approve` / `isAllowanceValid` manage the underlying-asset allowance on Sonic,
 * and the read methods query on-chain state.
 *
 * User-facing actions discriminated by `context.action`: `'deposit' | 'withdraw' |
 * 'approve' | 'vaultSwap'`. Read-only methods emit `LOOKUP_FAILED` partitioned by
 * `context.method`. Relay/verify codes appear only on `vaultSwap` — `createVaultIntent`
 * alone emits the create-intent subset.
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

export const leverageYieldInvariant: FeatureInvariant = createInvariant('leverageYield');

export type LeverageYieldAction =
  | 'deposit'
  | 'withdraw'
  | 'approve'
  | 'allowanceCheck'
  | 'vaultSwap'
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
 * The only code `getDetailedStatus` returns: no status source could produce a usable answer.
 * Narrower than {@link LeverageYieldLookupErrorCode}, which also admits `VALIDATION_FAILED` /
 * `UNKNOWN`. Prefixed because swap's equivalent is not — the root barrel is a flat `export *`, so
 * an unprefixed `DetailedStatusError` here would collide with it.
 */
export type LeverageYieldDetailedStatusErrorCode = Extract<SodaxErrorCode, 'LOOKUP_FAILED'>;

/**
 * Codes returnable by the solver-notify step inside `vaultSwap`. Mirrors the swap
 * domain's `PostExecutionErrorCode` — duplicated deliberately so the leverage-yield
 * error surface stands alone (see `vaultSwap`).
 */
export type LeverageYieldPostExecutionErrorCode = Extract<
  SodaxErrorCode,
  'EXECUTION_FAILED' | 'EXTERNAL_API_ERROR' | 'UNKNOWN'
>;

/**
 * Codes returnable by the end-to-end `vaultSwap` orchestrator: the create-intent subset
 * plus verify, relay and solver-notify codes. Mirrors the swap domain's `SwapErrorCode`.
 */
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
export const isLeverageYieldError = isCodeMember<LeverageYieldErrorCode>(LEVERAGE_YIELD_CODES);
