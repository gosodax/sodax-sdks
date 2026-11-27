import type { SodaxErrorCode, SodaxErrorContext, SodaxFeature } from './codes.js';
import { isIndeterminateOutcomeError } from './IndeterminateOutcomeError.js';
import { isSodaxError, SodaxError } from './SodaxError.js';

export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

type Ctx = Partial<SodaxErrorContext>;

/**
 * Wallet-rejection text patterns for wallets without a stable code (Solana, Sui, Stellar, Stacks, Bitcoin, NEAR,
 * Injective). The Hana `cancel_*` patterns overlap its `code` checks to catch errors whose `code` was dropped.
 */
const REJECTION_TEXT_PATTERNS: readonly RegExp[] = [
  /user rejected/i,
  /user denied/i,
  /user declined/i,
  /user cancel(?:l)?ed/i,
  /user abort(?:ed)?/i,
  /user closed/i,
  /rejected by user/i,
  /cancelled by user/i,
  /canceled by user/i,
  // `was` is mandatory: matches "Transaction was rejected" (user) but not "Transaction rejected by node".
  /transaction was rejected/i,
  /signature rejected/i,
  /request rejected/i,
  /cancel_signing/i,
  /cancel_json-rpc/i,
  /popup ?closed/i,
];

function matchRejectionText(text: unknown): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  for (const pattern of REJECTION_TEXT_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

function isWalletRejection(error: unknown): boolean {
  if (error == null) return false;
  // A SodaxError is already classified: trust its code, since e.g. the hardcoded USER_REJECTED message
  // would itself match `/user rejected/i` and reclassify other codes.
  if (isSodaxError(error)) return error.code === 'USER_REJECTED';
  if (typeof error === 'string') return matchRejectionText(error);
  if (typeof error !== 'object') return false;

  const o = error as {
    name?: string;
    code?: unknown;
    message?: string;
    shortMessage?: string;
    reason?: string;
    details?: string;
  };

  if (o.name === 'UserRejectedRequestError') return true;
  if (o.name === 'AtomicReadyWalletRejectedUpgradeError') return true;
  if (o.name === 'WalletSignTransactionError' && matchRejectionText(o.message)) return true;
  if (o.name === 'WalletConnectionError' && matchRejectionText(o.message)) return true;

  if (o.code === 4001) return true;
  if (o.code === 5750) return true;
  if (o.code === 'ACTION_REJECTED') return true;
  if (o.code === 'CANCEL_SIGNING') return true;
  if (o.code === 'CANCEL_JSON-RPC') return true;
  if (o.code === -31002) return true;

  if (matchRejectionText(o.shortMessage)) return true;
  if (matchRejectionText(o.details)) return true;
  if (matchRejectionText(o.message)) return true;
  if (matchRejectionText(o.reason)) return true;

  return false;
}

/** Hardcoded message: viem's rejection message is a multi-line dump unfit for UIs/issue titles; the raw cause stays on `cause`. */
function userRejected(feature: SodaxFeature, cause: unknown, context?: Ctx): SodaxError<'USER_REJECTED'> {
  return new SodaxError('USER_REJECTED', 'User rejected the request', {
    feature,
    cause,
    context,
  });
}

export function lookupFailed(
  feature: SodaxFeature,
  method: string,
  cause: unknown,
  context?: Ctx,
): SodaxError<'LOOKUP_FAILED'> {
  return new SodaxError('LOOKUP_FAILED', messageOf(cause, `${method} failed`), {
    feature,
    cause,
    context: { phase: 'lookup', method, ...context },
  });
}

export function verifyFailed(
  feature: SodaxFeature,
  cause: unknown,
  context?: Ctx,
): SodaxError<'TX_VERIFICATION_FAILED'> {
  return new SodaxError('TX_VERIFICATION_FAILED', 'Spoke transaction verification failed', {
    feature,
    cause,
    context: { phase: 'verify', ...context },
  });
}

/** Wraps the wallet-sign step: a wallet rejection classifies as `USER_REJECTED` instead. */
export function intentCreationFailed(
  feature: SodaxFeature,
  cause: unknown,
  context?: Ctx,
): SodaxError<'USER_REJECTED' | 'INTENT_CREATION_FAILED'> {
  const indeterminate = isIndeterminateOutcomeError(cause) ? cause : undefined;
  if (!indeterminate && isWalletRejection(cause)) {
    return userRejected(feature, cause, { phase: 'intentCreation', ...context });
  }
  return new SodaxError('INTENT_CREATION_FAILED', messageOf(cause, 'Intent creation failed'), {
    feature,
    cause,
    context: {
      phase: 'intentCreation',
      ...context,
      ...(indeterminate?.txHash !== undefined && { srcTxHash: indeterminate.txHash }),
      ...(indeterminate?.trackingId !== undefined && { trackingId: indeterminate.trackingId }),
      ...(indeterminate?.recovery !== undefined && { recovery: indeterminate.recovery }),
    },
  });
}

export function executionFailed(feature: SodaxFeature, cause: unknown, context?: Ctx): SodaxError<'EXECUTION_FAILED'> {
  return new SodaxError('EXECUTION_FAILED', messageOf(cause, 'Execution failed'), {
    feature,
    cause,
    context: { phase: 'execution', ...context },
  });
}

/** Wraps the wallet-sign step: a wallet rejection classifies as `USER_REJECTED` instead. */
export function approveFailed(
  feature: SodaxFeature,
  cause: unknown,
  context?: Ctx,
): SodaxError<'USER_REJECTED' | 'APPROVE_FAILED'> {
  if (isWalletRejection(cause)) return userRejected(feature, cause, { phase: 'approve', ...context });
  return new SodaxError('APPROVE_FAILED', messageOf(cause, 'Approve failed'), {
    feature,
    cause,
    context: { phase: 'approve', ...context },
  });
}

export function allowanceCheckFailed(
  feature: SodaxFeature,
  cause: unknown,
  context?: Ctx,
): SodaxError<'ALLOWANCE_CHECK_FAILED'> {
  return new SodaxError('ALLOWANCE_CHECK_FAILED', messageOf(cause, 'Allowance check failed'), {
    feature,
    cause,
    context: { phase: 'allowanceCheck', ...context },
  });
}

/** Re-issues `error` with `context` merged over its own; code, message, feature and cause are kept. */
export function withErrorContext<C extends SodaxErrorCode>(error: SodaxError<C>, context: Ctx): SodaxError<C> {
  return new SodaxError(error.code, error.message, {
    feature: error.feature,
    cause: error.cause,
    context: { ...error.context, ...context },
  });
}

export function gasEstimationFailed(
  feature: SodaxFeature,
  cause: unknown,
  context?: Ctx,
): SodaxError<'GAS_ESTIMATION_FAILED'> {
  return new SodaxError('GAS_ESTIMATION_FAILED', messageOf(cause, 'Gas estimation failed'), {
    feature,
    cause,
    context: { phase: 'gasEstimation', ...context },
  });
}

export function unknownFailed(feature: SodaxFeature, cause: unknown, context?: Ctx): SodaxError<'UNKNOWN'> {
  return new SodaxError('UNKNOWN', messageOf(cause, 'Unknown failure'), {
    feature,
    cause,
    context,
  });
}
