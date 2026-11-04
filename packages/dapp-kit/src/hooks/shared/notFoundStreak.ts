/**
 * The consecutive-ambiguous-read budget shared by the status polls.
 *
 * Some reads cannot distinguish "still in flight" from "will never resolve" — a solver that has not
 * seen an intent, a relay with no packet for a source tx. Polling those forever is the failure mode
 * a budget exists to stop, but only for that shape: a dependency failing *right now* must keep
 * polling, or a two-minute outage would permanently stick a transfer that is fine.
 *
 * Each feature decides what counts as an ambiguous miss and passes a boolean; the counting,
 * identity and de-duplication are the same everywhere and live here.
 *
 * Kept free of React and context imports so it is unit-testable in dapp-kit's `node` test
 * environment — importing a hook pulls in `useSodaxContext`.
 */

export const STATUS_POLL_MS = 3000;
/** Cap consecutive ambiguous polls (~2 min at 3s). The first one is a race, not a stop. */
export const MAX_NOT_FOUND_POLLS = 40;

export type NotFoundStreakState = {
  /** Identity of what is being polled — an intent tx hash, or a composite source-chain/tx key. */
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
 * Advances the counter once per successful query update. A `pollKey` change starts a new streak so
 * a prior transfer's count cannot stop the next one. React Query may call `refetchInterval` more
 * than once per fetch — same `dataUpdateCount` is a no-op.
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
