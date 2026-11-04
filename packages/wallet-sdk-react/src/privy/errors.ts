import { UserRejectedRequestError } from 'viem';
import { withDeadline } from '@/shared/withDeadline.js';

export class PrivyTimeoutError extends Error {
  override name = 'PrivyTimeoutError';
  constructor(what: string, ms: number) {
    super(`[wallet-sdk-react/privy] ${what} did not complete within ${ms} ms.`);
  }
}

/** The connector cannot use the current Privy session: it ended, was not signed out, or holds no embedded wallet. */
export class PrivySessionError extends Error {
  override name = 'PrivySessionError';
  constructor(message: string) {
    super(`[wallet-sdk-react/privy] ${message}`);
  }
}

export class PrivyUnavailableError extends Error {
  override name = 'PrivyUnavailableError';
  constructor() {
    super('[wallet-sdk-react/privy] The Privy provider is not mounted.');
  }
}

export function userRejected(message: string): UserRejectedRequestError {
  return new UserRejectedRequestError(new Error(`[wallet-sdk-react/privy] ${message}`));
}

/** Why a signal was aborted: the `Error` passed to `abort()`, else a user rejection. */
export function abortReason(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error ? signal.reason : userRejected('The Privy connection attempt was cancelled.');
}

/** Settles with `promise`, or rejects on the deadline or when `signal` aborts — whichever comes first. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string, signal?: AbortSignal): Promise<T> {
  return withDeadline(
    promise,
    ms,
    () => new PrivyTimeoutError(what, ms),
    signal,
    () => abortReason(signal),
  );
}
