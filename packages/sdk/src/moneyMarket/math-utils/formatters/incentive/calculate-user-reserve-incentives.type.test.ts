/** Pins the result type of the per-reserve user incentive calculation. */
import { describe, expectTypeOf, it } from 'vitest';
import type { UserReserveIncentive, calculateUserReserveIncentives } from './calculate-user-reserve-incentives.js';

describe('calculateUserReserveIncentives', () => {
  it('returns one entry per reward', () => {
    expectTypeOf<ReturnType<typeof calculateUserReserveIncentives>>().toEqualTypeOf<UserReserveIncentive[]>();
  });
});
