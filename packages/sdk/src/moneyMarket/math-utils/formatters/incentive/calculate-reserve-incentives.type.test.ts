/** Pins the result types of the reserve incentive calculations. */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  CalculateReserveIncentivesResponse,
  ReserveIncentiveResponse,
  calculateReserveIncentives,
  calculateRewardTokenPrice,
} from './calculate-reserve-incentives.js';

describe('reserve incentives', () => {
  it('calculateRewardTokenPrice returns a decimal string', () => {
    expectTypeOf<ReturnType<typeof calculateRewardTokenPrice>>().toEqualTypeOf<string>();
  });

  it('calculateReserveIncentives returns the supply and borrow incentives of one reserve', () => {
    expectTypeOf<ReturnType<typeof calculateReserveIncentives>>().toEqualTypeOf<CalculateReserveIncentivesResponse>();
    expectTypeOf<CalculateReserveIncentivesResponse>().toEqualTypeOf<{
      underlyingAsset: string;
      aIncentivesData: ReserveIncentiveResponse[];
      vIncentivesData: ReserveIncentiveResponse[];
    }>();
  });
});
