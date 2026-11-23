/** Pins the result type of the per-reward-token user incentive dictionary. */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  UserIncentiveData,
  UserIncentiveDict,
  calculateAllUserIncentives,
} from './calculate-all-user-incentives.js';

describe('calculateAllUserIncentives', () => {
  it('returns user incentives keyed by reward token', () => {
    expectTypeOf<ReturnType<typeof calculateAllUserIncentives>>().toEqualTypeOf<UserIncentiveDict>();
    expectTypeOf<UserIncentiveDict>().toEqualTypeOf<Record<string, UserIncentiveData>>();
  });
});
