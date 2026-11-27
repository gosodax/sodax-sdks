import { DETAILED_STATUS_NOT_DELIVERED, SodaxError, SolverIntentStatusCode, type DetailedSwapStatus } from '@sodax/sdk';
import { describe, expect, it } from 'vitest';
import {
  advanceNotFoundStreak,
  INITIAL_NOT_FOUND_STREAK,
  MAX_NOT_FOUND_POLLS,
  STATUS_POLL_MS,
} from '../shared/notFoundStreak.js';
import {
  getSolverDetailedStatusRefetchInterval,
  isSolverNotFound,
  toNotFoundBudgetRead,
} from '../shared/solverStatusPolicy.js';

/**
 * Guards the polling-stop invariant for `useDetailedStatus`. The two variants report terminality in
 * their own vocabularies, so the stop condition reads whichever source answered. Unresolved reads
 * share `useStatus`'s single budget — but only the ones that are ambiguous by nature (solver
 * `NOT_FOUND`, or a relay with no packet for the tx), never a dependency outage, which must keep
 * polling so it recovers on its own.
 */

/** Derived from the public union so the fixtures track the wire contract without a cast. */
type BackendStatus = Extract<DetailedSwapStatus, { source: 'backend' }>['data']['status'];

const backend = (status: BackendStatus): DetailedSwapStatus => ({
  source: 'backend',
  data: { txHash: '0xsrc', srcChainKey: 'arb', status, processingAttempts: 1 },
});

const solver = (status: SolverIntentStatusCode): DetailedSwapStatus => ({
  source: 'solver',
  dstTxHash: '0xdst',
  data: { status },
});

const ok = (value: DetailedSwapStatus) => ({ ok: true as const, value });

/** The relay has no packet for this tx — ambiguous between "not yet" and "never", so it is budgeted. */
const notDelivered = {
  ok: false as const,
  error: new SodaxError('LOOKUP_FAILED', 'relay has not delivered the intent to the hub yet', {
    feature: 'swap',
    context: { reason: DETAILED_STATUS_NOT_DELIVERED },
  }),
};

/** A dependency failing right now. Must NOT be budgeted, or an outage permanently stops the poll. */
const outage = {
  ok: false as const,
  error: new SodaxError('LOOKUP_FAILED', 'relay down', { feature: 'swap' }),
};

/** A key the backend rejected. Terminal, and reached before any budget — see the stop below. */
const rejectedKey = {
  ok: false as const,
  error: new SodaxError('LOOKUP_FAILED', 'rejected', { feature: 'swap', context: { status: 401 } }),
};

const KEY_A = 'arb:0xaaa';

/** Drives the streak the way the hook does, one query update per call. */
const advance = (
  state: typeof INITIAL_NOT_FOUND_STREAK,
  reads: (ReturnType<typeof ok> | typeof notDelivered | typeof outage | typeof rejectedKey)[],
  key = KEY_A,
  from = 1,
) =>
  reads.reduce(
    (acc, read, i) => advanceNotFoundStreak(acc, key, isSolverNotFound(toNotFoundBudgetRead(read)), from + i),
    state,
  );

describe('getSolverDetailedStatusRefetchInterval', () => {
  // Both terminal states of the `SubmitSwapTxStatusV2` wire contract. `'failed'` is unreachable via
  // `getDetailedStatus` today (the SDK routes abandoned records to the solver) — asserted here as
  // the hook's own contract, so a terminal record is never polled forever if that routing changes.
  it.each(['solved', 'failed'] as const)('stops on a backend record at the terminal status %s', status => {
    expect(getSolverDetailedStatusRefetchInterval(ok(backend(status)), 0)).toBe(false);
  });

  // A backend record is never stopped by the solver's budget — different vocabulary.
  it('keeps polling an in-flight backend record even at the cutoff', () => {
    expect(getSolverDetailedStatusRefetchInterval(ok(backend('relaying')), MAX_NOT_FOUND_POLLS)).toBe(STATUS_POLL_MS);
  });

  // The solver arm reuses the useStatus policy verbatim; its full matrix is in solverStatusPolicy.test.ts.
  it('defers a solver answer to the solver policy: stops when terminal, polls while in flight', () => {
    expect(getSolverDetailedStatusRefetchInterval(ok(solver(SolverIntentStatusCode.SOLVED)), 0)).toBe(false);
    expect(getSolverDetailedStatusRefetchInterval(ok(solver(SolverIntentStatusCode.STARTED_NOT_FINISHED)), 100)).toBe(
      STATUS_POLL_MS,
    );
  });

  it('keeps polling before the first read lands', () => {
    expect(getSolverDetailedStatusRefetchInterval(undefined, 0)).toBe(STATUS_POLL_MS);
  });

  // The regression this guards: a rejected key leaves the backend unanswered, so a relay miss behind
  // it is unprovable and never tagged `DETAILED_STATUS_NOT_DELIVERED`. Without its own stop the read
  // would poll both endpoints forever, because the budget it would need to exhaust never advances.
  it('stops a rejected key even though the not-delivered budget never advances', () => {
    expect(advance(INITIAL_NOT_FOUND_STREAK, Array(MAX_NOT_FOUND_POLLS).fill(rejectedKey)).consecutiveNotFound).toBe(0);
    expect(getSolverDetailedStatusRefetchInterval(rejectedKey, 0)).toBe(false);
    const forbidden = new SodaxError('LOOKUP_FAILED', 'rejected', { feature: 'swap', context: { status: 403 } });
    expect(getSolverDetailedStatusRefetchInterval({ ok: false, error: forbidden }, 0)).toBe(false);
  });

  // 503 is the transient key-verification failure, which is retried rather than surfaced.
  it('keeps polling a 503 from the key-verification path', () => {
    const unavailable = {
      ok: false as const,
      error: new SodaxError('LOOKUP_FAILED', 'verification unavailable', {
        feature: 'swap',
        context: { status: 503 },
      }),
    };
    expect(getSolverDetailedStatusRefetchInterval(unavailable, MAX_NOT_FOUND_POLLS)).toBe(STATUS_POLL_MS);
  });
});

describe('toNotFoundBudgetRead', () => {
  it('passes the solver arm through, neutralises the backend arm, counts a failed read', () => {
    expect(toNotFoundBudgetRead(ok(solver(SolverIntentStatusCode.STARTED_NOT_FINISHED)))).toEqual({
      ok: true,
      value: { status: SolverIntentStatusCode.STARTED_NOT_FINISHED },
    });
    expect(toNotFoundBudgetRead(ok(backend('relaying')))).toBeUndefined();
    expect(toNotFoundBudgetRead(undefined)).toBeUndefined();
    // Only the undelivered-packet miss is budgeted; an outage is not.
    expect(toNotFoundBudgetRead(notDelivered)).toEqual({
      ok: true,
      value: { status: SolverIntentStatusCode.NOT_FOUND },
    });
    expect(toNotFoundBudgetRead(outage)).toBeUndefined();
  });
});

describe('detailed-status budget', () => {
  it('counts consecutive solver NOT_FOUND reads up to the cutoff, then stops', () => {
    const notFound = ok(solver(SolverIntentStatusCode.NOT_FOUND));
    const state = advance({ ...INITIAL_NOT_FOUND_STREAK }, Array(MAX_NOT_FOUND_POLLS).fill(notFound));

    expect(state.consecutiveNotFound).toBe(MAX_NOT_FOUND_POLLS);
    expect(getSolverDetailedStatusRefetchInterval(notFound, MAX_NOT_FOUND_POLLS - 1)).toBe(STATUS_POLL_MS);
    expect(getSolverDetailedStatusRefetchInterval(notFound, state.consecutiveNotFound)).toBe(false);
  });

  // The regression this guards: a swap whose relay packet never lands used to poll forever, because
  // every LOOKUP_FAILED reset the budget it should have been spending.
  it('counts consecutive undelivered reads up to the cutoff, then stops', () => {
    const state = advance({ ...INITIAL_NOT_FOUND_STREAK }, Array(MAX_NOT_FOUND_POLLS).fill(notDelivered));

    expect(state.consecutiveNotFound).toBe(MAX_NOT_FOUND_POLLS);
    expect(getSolverDetailedStatusRefetchInterval(notDelivered, MAX_NOT_FOUND_POLLS - 1)).toBe(STATUS_POLL_MS);
    expect(getSolverDetailedStatusRefetchInterval(notDelivered, state.consecutiveNotFound)).toBe(false);
  });

  // The regression this guards: a 2-minute solver or relay outage used to exhaust the budget and
  // stop the poll for good, turning recoverable downtime into a permanently stuck status.
  it('never exhausts the budget on an outage, however long it runs', () => {
    const state = advance({ ...INITIAL_NOT_FOUND_STREAK }, Array(MAX_NOT_FOUND_POLLS * 2).fill(outage));

    expect(state.consecutiveNotFound).toBe(0);
    expect(getSolverDetailedStatusRefetchInterval(outage, state.consecutiveNotFound)).toBe(STATUS_POLL_MS);
    expect(getSolverDetailedStatusRefetchInterval(outage, 10_000)).toBe(STATUS_POLL_MS);
  });

  // The backend answering mid-run is not an unresolved read, so the budget starts over.
  it('resets the budget when a backend record answers after a NOT_FOUND run', () => {
    const state = advance(
      { pollKey: KEY_A, seenUpdates: 39, consecutiveNotFound: 39 },
      [ok(backend('relaying'))],
      KEY_A,
      40,
    );

    expect(state.consecutiveNotFound).toBe(0);
    expect(getSolverDetailedStatusRefetchInterval(ok(backend('relaying')), state.consecutiveNotFound)).toBe(
      STATUS_POLL_MS,
    );
  });
});
