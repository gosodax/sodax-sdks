// Budget only for ambiguous misses; a dependency failing right now must keep polling.
// Kept free of React/context imports so it is unit-testable in the `node` test env.

export const STATUS_POLL_MS = 3000;
/** Cap consecutive ambiguous polls (~2 min at 3s). The first one is a race, not a stop. */
export const MAX_NOT_FOUND_POLLS = 40;
/** Cap for reads tagged `context.mpcRelay` (~5 min at 3s); the SDK allows an MPC-relay leg at least 5 min. */
export const MAX_MPC_RELAY_NOT_FOUND_POLLS = 100;

export type NotFoundStreakState = {
  pollKey: string | undefined;
  seenUpdates: number;
  consecutiveNotFound: number;
};

export const INITIAL_NOT_FOUND_STREAK: NotFoundStreakState = {
  pollKey: undefined,
  seenUpdates: 0,
  consecutiveNotFound: 0,
};

export function nextNotFoundStreak(isAmbiguousMiss: boolean, previousStreak: number): number {
  return isAmbiguousMiss ? previousStreak + 1 : 0;
}

/**
 * Advances once per query update; a new `pollKey` resets the streak. React Query may call
 * `refetchInterval` more than once per fetch, so a repeated `dataUpdateCount` is a no-op.
 */
export function advanceNotFoundStreak(
  state: NotFoundStreakState,
  pollKey: string | undefined,
  isAmbiguousMiss: boolean,
  dataUpdateCount: number,
): NotFoundStreakState {
  if (state.pollKey !== pollKey) {
    state = { pollKey, seenUpdates: 0, consecutiveNotFound: 0 };
  }
  if (state.seenUpdates === dataUpdateCount) {
    return state;
  }
  return {
    pollKey,
    seenUpdates: dataUpdateCount,
    consecutiveNotFound: nextNotFoundStreak(isAmbiguousMiss, state.consecutiveNotFound),
  };
}
