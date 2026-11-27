/** All four operations share one code shape; the action is carried on `context.action`, never in the type. */

import {
  ALLOWANCE_CHECK_CODES,
  APPROVE_CODES,
  type AllowanceCheckErrorCode,
  type ApproveErrorCode,
  CREATE_INTENT_CODES,
  type CreateIntentErrorCode,
  GAS_ESTIMATION_CODES,
  type GasEstimationErrorCode,
  type SodaxErrorCode,
} from '../errors/codes.js';
import { isCodeMember } from '../errors/guards.js';
import { createInvariant, type FeatureInvariant } from '../errors/invariant.js';
import type { SodaxError } from '../errors/SodaxError.js';

export const mmInvariant: FeatureInvariant = createInvariant('moneyMarket');

export type MoneyMarketAction = 'supply' | 'borrow' | 'withdraw' | 'repay';

export type MoneyMarketCreateIntentErrorCode = CreateIntentErrorCode;

/** Codes any of the 4 orchestrators (`supply`/`borrow`/`withdraw`/`repay`) can return. */
export type MoneyMarketOrchestrationErrorCode = Extract<
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

export type MoneyMarketApproveErrorCode = ApproveErrorCode;
export type MoneyMarketAllowanceCheckErrorCode = AllowanceCheckErrorCode;
export type MoneyMarketGasEstimationErrorCode = GasEstimationErrorCode;

export type MoneyMarketErrorCode =
  | MoneyMarketOrchestrationErrorCode
  | MoneyMarketApproveErrorCode
  | MoneyMarketAllowanceCheckErrorCode
  | MoneyMarketGasEstimationErrorCode;

export type MoneyMarketCreateIntentError = SodaxError<MoneyMarketCreateIntentErrorCode>;
export type MoneyMarketOrchestrationError = SodaxError<MoneyMarketOrchestrationErrorCode>;
export type MoneyMarketApproveError = SodaxError<MoneyMarketApproveErrorCode>;
export type MoneyMarketAllowanceCheckError = SodaxError<MoneyMarketAllowanceCheckErrorCode>;
export type MoneyMarketGasEstimationError = SodaxError<MoneyMarketGasEstimationErrorCode>;
export type MoneyMarketError = SodaxError<MoneyMarketErrorCode>;

const ORCHESTRATION_CODES: ReadonlySet<MoneyMarketOrchestrationErrorCode> = new Set([
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

const MONEY_MARKET_CODES: ReadonlySet<MoneyMarketErrorCode> = new Set<MoneyMarketErrorCode>([
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
  'GAS_ESTIMATION_FAILED',
  'UNKNOWN',
]);

export const isMoneyMarketCreateIntentError = isCodeMember<MoneyMarketCreateIntentErrorCode>(CREATE_INTENT_CODES);
export const isMoneyMarketOrchestrationError = isCodeMember<MoneyMarketOrchestrationErrorCode>(ORCHESTRATION_CODES);
export const isMoneyMarketApproveError = isCodeMember<MoneyMarketApproveErrorCode>(APPROVE_CODES);
export const isMoneyMarketAllowanceCheckError = isCodeMember<MoneyMarketAllowanceCheckErrorCode>(ALLOWANCE_CHECK_CODES);
export const isMoneyMarketGasEstimationError = isCodeMember<MoneyMarketGasEstimationErrorCode>(GAS_ESTIMATION_CODES);
export const isMoneyMarketError = isCodeMember<MoneyMarketErrorCode>(MONEY_MARKET_CODES);
