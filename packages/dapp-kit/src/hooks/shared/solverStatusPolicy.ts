// Read types are structural so this module does not own a feature hook's public contract.
// Kept free of React/context imports so it is unit-testable in the `node` test env.
import {
  DETAILED_STATUS_NOT_DELIVERED,
  isAuthFailure,
  SolverIntentStatusCode,
  type Result,
  type SodaxError,
  type SolverErrorResponse,
  type SolverIntentStatusResponse,
} from '@sodax/sdk';

import { MAX_NOT_FOUND_POLLS, STATUS_POLL_MS } from './notFoundStreak.js';

export type SolverStatusRead = Result<SolverIntentStatusResponse, SolverErrorResponse> | undefined;

/** Structural minimum of a detailed-status read; feature arms may carry more fields. */
export type SolverDetailedStatusRead =
  | Result<
      { source: 'backend'; data: { status: string } } | { source: 'solver'; data: SolverIntentStatusResponse },
      SodaxError<'LOOKUP_FAILED'>
    >
  | undefined;

/** Stops on SOLVED/FAILED, or after `MAX_NOT_FOUND_POLLS` consecutive NOT_FOUNDs; in-flight polls uncapped. */
export function getSolverStatusRefetchInterval(data: SolverStatusRead, consecutiveNotFound: number): number | false {
  const status = data?.ok ? data.value.status : undefined;
  if (status === SolverIntentStatusCode.SOLVED || status === SolverIntentStatusCode.FAILED) {
    return false;
  }
  if (status === SolverIntentStatusCode.NOT_FOUND && consecutiveNotFound >= MAX_NOT_FOUND_POLLS) {
    return false;
  }
  return STATUS_POLL_MS;
}

export function isSolverNotFound(data: SolverStatusRead): boolean {
  return (data?.ok ? data.value.status : undefined) === SolverIntentStatusCode.NOT_FOUND;
}

/**
 * Only `DETAILED_STATUS_NOT_DELIVERED` failures count as NOT_FOUND; other lookup failures are outages
 * and reset the budget so polling resumes when they end.
 */
export function toNotFoundBudgetRead(data: SolverDetailedStatusRead): SolverStatusRead {
  if (data === undefined) return undefined;
  if (data.ok) {
    return data.value.source === 'solver' ? { ok: true, value: data.value.data } : undefined;
  }
  return data.error?.context?.reason === DETAILED_STATUS_NOT_DELIVERED
    ? { ok: true, value: { status: SolverIntentStatusCode.NOT_FOUND } }
    : undefined;
}

export function getSolverDetailedStatusRefetchInterval(
  data: SolverDetailedStatusRead,
  consecutiveNotFound: number,
): number | false {
  // The SDK returns 401/403 as a Result, so `retryUnlessAuthFailure` never sees it; stop here instead.
  if (data && !data.ok && isAuthFailure(data.error)) return false;
  if (data?.ok && data.value.source === 'backend') {
    // SDK currently routes 'failed' to the solver; still treat it as terminal in case routing changes.
    const { status } = data.value.data;
    return status === 'solved' || status === 'failed' ? false : STATUS_POLL_MS;
  }
  return getSolverStatusRefetchInterval(toNotFoundBudgetRead(data), consecutiveNotFound);
}
