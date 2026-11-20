/** Pins the result type of the per-reserve incentive dictionary. */
import { describe, expectTypeOf, it } from 'vitest';
import type { ReserveIncentiveDict, calculateAllReserveIncentives } from './calculate-all-reserve-incentives.js';

type ReserveIncentive = { incentiveAPR: string; rewardTokenAddress: string; rewardTokenSymbol: string };

describe('calculateAllReserveIncentives', () => {
  it('returns incentives keyed by underlying asset', () => {
    expectTypeOf<ReturnType<typeof calculateAllReserveIncentives>>().toEqualTypeOf<ReserveIncentiveDict>();
    expectTypeOf<ReserveIncentiveDict>().toEqualTypeOf<
      Record<string, { aIncentives: ReserveIncentive[]; vIncentives: ReserveIncentive[] }>
    >();
  });
});
