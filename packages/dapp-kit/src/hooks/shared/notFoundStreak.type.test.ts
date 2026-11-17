/**
 * Compile-time contract: the not-found budget helpers return a plain count and the full streak state.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { advanceNotFoundStreak, NotFoundStreakState, nextNotFoundStreak } from './notFoundStreak.js';

describe('nextNotFoundStreak', () => {
  it('maps a miss flag and the previous count to the next count', () => {
    expectTypeOf<Parameters<typeof nextNotFoundStreak>>().toEqualTypeOf<
      [isAmbiguousMiss: boolean, previousStreak: number]
    >();
    expectTypeOf<ReturnType<typeof nextNotFoundStreak>>().toEqualTypeOf<number>();
  });
});

describe('NotFoundStreakState', () => {
  it('holds the poll identity, the last seen update and the streak', () => {
    expectTypeOf<NotFoundStreakState>().toEqualTypeOf<{
      pollKey: string | undefined;
      seenUpdates: number;
      consecutiveNotFound: number;
    }>();
  });
});

describe('advanceNotFoundStreak', () => {
  it('returns the next streak state', () => {
    expectTypeOf<Parameters<typeof advanceNotFoundStreak>>().toEqualTypeOf<
      [state: NotFoundStreakState, pollKey: string | undefined, isAmbiguousMiss: boolean, dataUpdateCount: number]
    >();
    expectTypeOf<ReturnType<typeof advanceNotFoundStreak>>().toEqualTypeOf<{
      pollKey: string | undefined;
      seenUpdates: number;
      consecutiveNotFound: number;
    }>();
  });
});
