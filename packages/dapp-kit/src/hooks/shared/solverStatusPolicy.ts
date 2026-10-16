/**
 * The polling policy shared by every solver-backed status read.
 *
 * Two features now resolve a source tx to a solver answer — swap and leverage yield — and their
 * status unions are structurally the same, so the terminality rules and the ambiguous-miss mapping
 * are identical. They live here rather than in one feature's folder: `hooks/` has no cross-feature
 * imports anywhere else, and a second verbatim copy is what this extraction exists to prevent.
 * Bridge keeps its own policy beside its hook, because its second arm is a relay packet that is
 * terminal on arrival and has no solver vocabulary at all.
 *
 * The read types are declared structurally rather than imported from either feature: this module
 * must not own another hook's public contract, and both `DetailedSwapStatus` and
 * `DetailedLeverageYieldStatus` satisfy the shape below.
 *
 * Kept free of React and context imports so it is unit-testable in dapp-kit's `node` test
 * environment — importing a hook pulls in `useSodaxContext`.
 */
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

/** A solver status read, as `useStatus` holds it. */
export type SolverStatusRead = Result<SolverIntentStatusResponse, SolverErrorResponse> | undefined;

/**
 * The structural minimum a detailed-status read must satisfy to use this policy: a backend arm
 * reporting terminality in the submit-tx vocabulary, and a solver arm carrying the solver's own
 * response. A feature's arm may carry more (leverage yield and swap both hoist `dstTxHash`); only
 * what is read here is required.
 */
export type SolverDetailedStatusRead =
  | Result<
      { source: 'backend'; data: { status: string } } | { source: 'solver'; data: SolverIntentStatusResponse },
      SodaxError<'LOOKUP_FAILED'>
    >
  | undefined;

/**
 * Polling interval for a plain solver status read (`useStatus`). Stops on SOLVED/FAILED immediately;
 * stops on NOT_FOUND only after `MAX_NOT_FOUND_POLLS` consecutive successful fetches (solver forgot /
 * never saw the intent). In-flight statuses keep polling with no global cap.
 */
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

/** The read shape the budget counts: a solver that has not seen this intent. */
export function isSolverNotFound(data: SolverStatusRead): boolean {
  return (data?.ok ? data.value.status : undefined) === SolverIntentStatusCode.NOT_FOUND;
}

/**
 * Maps a detailed-status read onto the shape the shared NOT_FOUND policy consumes, three ways:
 *
 * - solver arm → passes through, so its status drives the budget as it does for `useStatus`;
 * - backend arm → `undefined`, which resets the budget; the solver is not the one being asked;
 * - failed read → counts as `NOT_FOUND` **only** when the relay has no packet for this source tx
 *   (`DETAILED_STATUS_NOT_DELIVERED`). That miss is ambiguous — a transfer still in flight and one
 *   whose tx never relayed look the same — so a budget is the only way to stop the second case.
 *
 * Every other `LOOKUP_FAILED` is a dependency failing right now: the relay unreachable, a malformed
 * response, the solver down. Those reset the budget and keep polling, because that is how the read
 * recovers when the outage ends. Counting them would stop polling a healthy transfer after ~2 min of
 * downtime and never resume.
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

/**
 * Polling interval for a detailed-status read. Backend records report terminality in their own
 * vocabulary; everything else reuses the solver policy verbatim, so `MAX_NOT_FOUND_POLLS` stays the
 * single cutoff — for a forgotten intent and for a transfer no source can resolve.
 *
 * A rejected API key is the one stop that sits outside both: `retryUnlessAuthFailure` cannot catch
 * it, because the SDK returns the 401/403 as a `Result` rather than throwing, so React Query never
 * sees an error to withhold a retry from. Without this branch a bad key polls forever whenever the
 * relay has also not delivered — the miss is unprovable behind an unanswered backend, so it never
 * consumes the not-delivered budget either.
 */
export function getSolverDetailedStatusRefetchInterval(
  data: SolverDetailedStatusRead,
  consecutiveNotFound: number,
): number | false {
  // A rejected key is terminal — only a corrected key changes the answer, so stop asking.
  if (data && !data.ok && isAuthFailure(data.error)) return false;
  if (data?.ok && data.value.source === 'backend') {
    // Both terminal states of the submit-tx status vocabulary. Today the SDK routes `'failed'`
    // records to the solver so only `'solved'` reaches us, but that is its routing rule, not this
    // hook's contract — encoding the wire contract keeps a terminal record from being polled forever
    // if it changes.
    const { status } = data.value.data;
    return status === 'solved' || status === 'failed' ? false : STATUS_POLL_MS;
  }
  return getSolverStatusRefetchInterval(toNotFoundBudgetRead(data), consecutiveNotFound);
}
