import { SolverIntentErrorCode, SolverIntentStatusCode } from '@sodax/sdk';
import { describe, expect, it } from 'vitest';
import {
  advanceNotFoundStreak,
  INITIAL_NOT_FOUND_STREAK,
  MAX_NOT_FOUND_POLLS,
  nextNotFoundStreak,
  STATUS_POLL_MS,
} from './notFoundStreak.js';
import { getSolverStatusRefetchInterval, isSolverNotFound } from './solverStatusPolicy.js';

/**
 * Guards the polling-stop invariant for `useStatus.refetchInterval`: keep polling until SOLVED/
 * FAILED, or until NOT_FOUND has been consecutive for MAX_NOT_FOUND_POLLS successful fetches.
 * Tested as a pure function because dapp-kit's vitest runs in the `node` environment.
 */
const HASH_A = '0xaaa';
const HASH_B = '0xbbb';
const ok = (status: SolverIntentStatusCode) => ({ ok: true as const, value: { status } });

const solverError = {
  ok: false as const,
  error: { detail: { code: SolverIntentErrorCode.INTENT_NOT_FOUND, message: 'missing' } },
};

describe('getSolverStatusRefetchInterval', () => {
  it('stops immediately on SOLVED (3) and FAILED (4), even at consecutive count 1', () => {
    expect(getSolverStatusRefetchInterval(ok(SolverIntentStatusCode.SOLVED), 1)).toBe(false);
    expect(getSolverStatusRefetchInterval(ok(SolverIntentStatusCode.FAILED), 1)).toBe(false);
  });

  it('keeps polling NOT_FOUND until MAX_NOT_FOUND_POLLS consecutive, then stops', () => {
    expect(getSolverStatusRefetchInterval(ok(SolverIntentStatusCode.NOT_FOUND), MAX_NOT_FOUND_POLLS - 1)).toBe(
      STATUS_POLL_MS,
    );
    expect(getSolverStatusRefetchInterval(ok(SolverIntentStatusCode.NOT_FOUND), MAX_NOT_FOUND_POLLS)).toBe(false);
  });

  it('never stops in-flight NOT_STARTED_YET (1) or STARTED_NOT_FINISHED (2), even at a high count', () => {
    expect(getSolverStatusRefetchInterval(ok(SolverIntentStatusCode.NOT_STARTED_YET), 100)).toBe(STATUS_POLL_MS);
    expect(getSolverStatusRefetchInterval(ok(SolverIntentStatusCode.STARTED_NOT_FINISHED), 100)).toBe(STATUS_POLL_MS);
  });

  it('keeps polling the first NOT_FOUND after a long in-flight streak', () => {
    expect(getSolverStatusRefetchInterval(ok(SolverIntentStatusCode.NOT_FOUND), 1)).toBe(STATUS_POLL_MS);
  });

  it('keeps polling when no status has arrived yet (undefined) or the Result is ok: false', () => {
    expect(getSolverStatusRefetchInterval(undefined, 1)).toBe(STATUS_POLL_MS);
    expect(getSolverStatusRefetchInterval(solverError, MAX_NOT_FOUND_POLLS)).toBe(STATUS_POLL_MS);
  });
});

describe('nextNotFoundStreak', () => {
  it('increments only while status is NOT_FOUND and resets otherwise', () => {
    expect(nextNotFoundStreak(isSolverNotFound(ok(SolverIntentStatusCode.NOT_FOUND)), 0)).toBe(1);
    expect(nextNotFoundStreak(isSolverNotFound(ok(SolverIntentStatusCode.NOT_FOUND)), 39)).toBe(40);
    expect(nextNotFoundStreak(isSolverNotFound(ok(SolverIntentStatusCode.STARTED_NOT_FINISHED)), 39)).toBe(0);
    expect(nextNotFoundStreak(isSolverNotFound(undefined), 5)).toBe(0);
    expect(nextNotFoundStreak(isSolverNotFound(solverError), 5)).toBe(0);
  });
});

describe('advanceNotFoundStreak', () => {
  it('increments consecutive NOT_FOUND once per dataUpdateCount, not per refetchInterval call', () => {
    let state = INITIAL_NOT_FOUND_STREAK;
    state = advanceNotFoundStreak(state, HASH_A, isSolverNotFound(ok(SolverIntentStatusCode.NOT_FOUND)), 1);
    expect(state.consecutiveNotFound).toBe(1);
    state = advanceNotFoundStreak(state, HASH_A, isSolverNotFound(ok(SolverIntentStatusCode.NOT_FOUND)), 1);
    expect(state.consecutiveNotFound).toBe(1);
    state = advanceNotFoundStreak(state, HASH_A, isSolverNotFound(ok(SolverIntentStatusCode.NOT_FOUND)), 2);
    expect(state.consecutiveNotFound).toBe(2);
  });

  it('resets the streak when an in-flight status follows a long NOT_FOUND run', () => {
    const started = advanceNotFoundStreak(
      { pollKey: HASH_A, seenUpdates: 39, consecutiveNotFound: 39 },
      HASH_A,
      isSolverNotFound(ok(SolverIntentStatusCode.STARTED_NOT_FINISHED)),
      40,
    );
    expect(started.consecutiveNotFound).toBe(0);
  });

  it('starts a new streak at 1 after in-flight polls, so a solver restart cannot stop the query', () => {
    let state = INITIAL_NOT_FOUND_STREAK;
    state = advanceNotFoundStreak(state, HASH_A, isSolverNotFound(ok(SolverIntentStatusCode.STARTED_NOT_FINISHED)), 40);
    state = advanceNotFoundStreak(state, HASH_A, isSolverNotFound(ok(SolverIntentStatusCode.NOT_FOUND)), 41);
    expect(state.consecutiveNotFound).toBe(1);
    expect(getSolverStatusRefetchInterval(ok(SolverIntentStatusCode.NOT_FOUND), state.consecutiveNotFound)).toBe(
      STATUS_POLL_MS,
    );
  });

  it('resets on pollKey change so a prior intent cannot consume the next budget', () => {
    const state = advanceNotFoundStreak(
      { pollKey: HASH_A, seenUpdates: 39, consecutiveNotFound: 39 },
      HASH_B,
      isSolverNotFound(ok(SolverIntentStatusCode.NOT_FOUND)),
      1,
    );
    expect(state.consecutiveNotFound).toBe(1);
    expect(state.pollKey).toBe(HASH_B);
  });
});
