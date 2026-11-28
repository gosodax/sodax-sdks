import type { SodaxFeature } from '@sodax/types';
import type { RelayExtraData } from '../shared/types/relay-types.js';

/**
 * Failure reasons, never the feature (that is `error.feature`; the operation is `context.action`). `RELAY_FAILED`
 * carries `context.relayCode`, `LOOKUP_FAILED` `context.method`, `EXTERNAL_API_ERROR` `context.api`.
 */
export type SodaxErrorCode =
  | 'USER_REJECTED'
  | 'VALIDATION_FAILED'
  | 'INTENT_CREATION_FAILED'
  | 'EXECUTION_FAILED'
  | 'TX_VERIFICATION_FAILED'
  | 'TX_SUBMIT_FAILED'
  | 'RELAY_TIMEOUT'
  | 'RELAY_FAILED'
  | 'APPROVE_FAILED'
  | 'ALLOWANCE_CHECK_FAILED'
  | 'GAS_ESTIMATION_FAILED'
  | 'LOOKUP_FAILED'
  | 'EXTERNAL_API_ERROR'
  | 'UNKNOWN';

/** Defined in `@sodax/types` (shared with analytics) and re-exported so existing `@sodax/sdk` imports keep working. */
export type { SodaxFeature };

/**
 * `context.phase` tag; every feature draws from this list. `destinationExecution` is migration's bnUSD
 * watcher; `postExecution` is swap's post-relay solver step.
 */
export type SodaxPhase =
  | 'validate'
  | 'intentCreation'
  | 'verify'
  | 'submit'
  | 'relay'
  | 'destinationExecution'
  | 'execution'
  | 'postExecution'
  | 'approve'
  | 'allowanceCheck'
  | 'gasEstimation'
  | 'lookup';

/** Mirrors `RELAY_ERROR_CODES` on `context.relayCode` for errors from the relay layer. */
export type RelayCode = 'SUBMIT_TX_FAILED' | 'RELAY_TIMEOUT' | 'RELAY_POLLING_FAILED' | 'UNKNOWN';

/** Open index signature for feature-specific metadata; {@link SodaxError.toJSON} sanitises arbitrary values. */
export type SodaxErrorContext = {
  action?: string;
  phase?: SodaxPhase;
  srcChainKey?: string;
  srcTxHash?: string;
  hubTxHash?: string;
  trackingId?: string;
  relayData?: RelayExtraData;
  recovery?: unknown;
  dstChainKey?: string;
  relayCode?: RelayCode;
  api?: 'solver' | 'backend' | 'swaps' | 'leverageYield' | 'sponsoring' | 'bridge';
  method?: string;
  status?: number;
  nextAction?: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
  sponsorSequence?: string;
  direction?: 'forward' | 'reverse';
  field?: string;
  reason?: string;
  [key: string]: unknown;
};

// Shared code subsets reused by per-feature `errors.ts` `isCodeMember` guards.

export type CreateIntentErrorCode = Extract<
  SodaxErrorCode,
  'USER_REJECTED' | 'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN'
>;
export type ApproveErrorCode = Extract<
  SodaxErrorCode,
  'USER_REJECTED' | 'VALIDATION_FAILED' | 'APPROVE_FAILED' | 'UNKNOWN'
>;
export type AllowanceCheckErrorCode = Extract<
  SodaxErrorCode,
  'VALIDATION_FAILED' | 'ALLOWANCE_CHECK_FAILED' | 'UNKNOWN'
>;
export type GasEstimationErrorCode = Extract<SodaxErrorCode, 'VALIDATION_FAILED' | 'GAS_ESTIMATION_FAILED' | 'UNKNOWN'>;
export type LookupErrorCode = Extract<SodaxErrorCode, 'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'UNKNOWN'>;

export const CREATE_INTENT_CODES: ReadonlySet<CreateIntentErrorCode> = new Set([
  'USER_REJECTED',
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'UNKNOWN',
]);

export const APPROVE_CODES: ReadonlySet<ApproveErrorCode> = new Set([
  'USER_REJECTED',
  'VALIDATION_FAILED',
  'APPROVE_FAILED',
  'UNKNOWN',
]);

export const ALLOWANCE_CHECK_CODES: ReadonlySet<AllowanceCheckErrorCode> = new Set([
  'VALIDATION_FAILED',
  'ALLOWANCE_CHECK_FAILED',
  'UNKNOWN',
]);

export const GAS_ESTIMATION_CODES: ReadonlySet<GasEstimationErrorCode> = new Set([
  'VALIDATION_FAILED',
  'GAS_ESTIMATION_FAILED',
  'UNKNOWN',
]);

export const LOOKUP_CODES: ReadonlySet<LookupErrorCode> = new Set(['VALIDATION_FAILED', 'LOOKUP_FAILED', 'UNKNOWN']);

export const SODAX_ERROR_CODES = [
  'USER_REJECTED',
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'EXECUTION_FAILED',
  'TX_VERIFICATION_FAILED',
  'TX_SUBMIT_FAILED',
  'RELAY_TIMEOUT',
  'RELAY_FAILED',
  'APPROVE_FAILED',
  'ALLOWANCE_CHECK_FAILED',
  'GAS_ESTIMATION_FAILED',
  'LOOKUP_FAILED',
  'EXTERNAL_API_ERROR',
  'UNKNOWN',
] as const satisfies ReadonlyArray<SodaxErrorCode>;

export const SODAX_FEATURES = [
  'swap',
  'moneyMarket',
  'bridge',
  'staking',
  'migration',
  'dex',
  'partner',
  'recovery',
  'backend',
  'sponsoring',
  'leverageYield',
] as const satisfies ReadonlyArray<SodaxFeature>;
