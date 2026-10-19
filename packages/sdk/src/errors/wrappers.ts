/**
 * Constructor helpers for the most common {@link SodaxError} shapes.
 *
 * Each wrapper binds a code, a default phase, and the boilerplate of extracting a message from
 * an unknown cause — so service-layer call sites read as
 * `lookupFailed('dex', 'getPoolData', err)` instead of a 6-line `new SodaxError(...)` literal.
 */

import type { SodaxErrorCode, SodaxErrorContext, SodaxFeature } from './codes.js';
import { isSodaxError, SodaxError } from './SodaxError.js';

/** Extract `error.message` if `error` is an `Error`; otherwise return the fallback. */
export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

type Ctx = Partial<SodaxErrorContext>;

/**
 * Private wallet-rejection detector. Used inside wrappers that wrap wallet-sign operations
 * (`intentCreationFailed`, `approveFailed`) so the canonical `USER_REJECTED` code surfaces
 * uniformly across features without each service catch block re-implementing the
 * shape-matching logic.
 *
 * Shapes recognised:
 * - EVM (viem):                `UserRejectedRequestError`, EIP-1193 code `4001`,
 *                              ethers-compat `code === 'ACTION_REJECTED'`, and EIP-5792's
 *                              declined account upgrade (`AtomicReadyWalletRejectedUpgradeError`, `5750`).
 * - ICON (Hana):               `code === 'CANCEL_SIGNING'` / `'CANCEL_JSON-RPC'` / `-31002`.
 * - Solana / Sui / Stellar /
 *   Stacks / Bitcoin / NEAR /
 *   Injective:                 falls back to error `name` + message-pattern match — those
 *                              wallet libraries do not expose a stable numeric code.
 *
 * The `cancel_signing` / `cancel_json-rpc` text patterns intentionally overlap with the
 * Hana `code` checks above so that a Hana error with a string message but no `code` field
 * (e.g. when bubbled up by intermediate layers) still classifies correctly.
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
  // `was` is mandatory: matches Phantom / Brave's "Transaction was rejected" (user cancellation)
  // but NOT bare "Transaction rejected by node / by validator" (network or chain-level reject).
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
  // A `SodaxError` is already classified at the source — trust its `code` field instead of
  // scanning its message. Without this guard, the canonical `USER_REJECTED` message
  // ('User rejected the request') hardcoded by the `userRejected` factory would itself match
  // `/user rejected/i` further down, so a `SodaxError<'VALIDATION_FAILED'>` whose message
  // happens to include rejection-like prose (or any future `intentCreationFailed(feature,
  // sodaxError)` call that skips the per-code-set guard at the call site) would be silently
  // reclassified as `USER_REJECTED`. The guard makes the contract explicit and message-content
  // false positives impossible.
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

/**
 * Build a `USER_REJECTED` SodaxError with a clean, hardcoded message. We deliberately do NOT
 * inherit `cause.message` here — viem's `UserRejectedRequestError` carries a multi-line dump
 * (Request Arguments, encoded calldata, Version) that's useful for debugging but terrible as
 * an end-user error message or Sentry/Datadog issue title. The raw cause is still available
 * on `error.cause` for whoever needs to inspect it.
 */
function userRejected(feature: SodaxFeature, cause: unknown, context?: Ctx): SodaxError<'USER_REJECTED'> {
  return new SodaxError('USER_REJECTED', 'User rejected the request', {
    feature,
    cause,
    context,
  });
}

/** `LOOKUP_FAILED` for read-only on-chain queries / off-chain config fetches. */
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

/** `TX_VERIFICATION_FAILED` — spoke `verifyTxHash` returned false / threw. */
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

/**
 * `INTENT_CREATION_FAILED` — spoke deposit / sendMessage / intent build failed.
 *
 * Wraps the wallet-sign step. If the cause matches a wallet rejection shape, classifies as
 * `USER_REJECTED` instead so consumers can branch on a single canonical "cancelled" code.
 */
export function intentCreationFailed(
  feature: SodaxFeature,
  cause: unknown,
  context?: Ctx,
): SodaxError<'USER_REJECTED' | 'INTENT_CREATION_FAILED'> {
  if (isWalletRejection(cause)) return userRejected(feature, cause, { phase: 'intentCreation', ...context });
  return new SodaxError('INTENT_CREATION_FAILED', messageOf(cause, 'Intent creation failed'), {
    feature,
    cause,
    context: { phase: 'intentCreation', ...context },
  });
}

/** `EXECUTION_FAILED` — orchestrator-level catch-all. `context.action` discriminates the op. */
export function executionFailed(feature: SodaxFeature, cause: unknown, context?: Ctx): SodaxError<'EXECUTION_FAILED'> {
  return new SodaxError('EXECUTION_FAILED', messageOf(cause, 'Execution failed'), {
    feature,
    cause,
    context: { phase: 'execution', ...context },
  });
}

/**
 * `APPROVE_FAILED` — token approval call failed.
 *
 * Wraps the wallet-sign step. If the cause matches a wallet rejection shape, classifies as
 * `USER_REJECTED` instead.
 */
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

/** `ALLOWANCE_CHECK_FAILED` — reading on-chain allowance failed. */
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

/** `GAS_ESTIMATION_FAILED` — gas estimation call failed. */
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

/** `UNKNOWN` — last-resort outer catch when no narrower code applies. */
export function unknownFailed(feature: SodaxFeature, cause: unknown, context?: Ctx): SodaxError<'UNKNOWN'> {
  return new SodaxError('UNKNOWN', messageOf(cause, 'Unknown failure'), {
    feature,
    cause,
    context,
  });
}
