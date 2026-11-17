/** Pins the result type of the reserve debt calculation. */
import type BigNumber from 'bignumber.js';
import { describe, expectTypeOf, it } from 'vitest';
import type { CalculateReserveDebtResponse, calculateReserveDebt } from './calculate-reserve-debt.js';

describe('calculateReserveDebt', () => {
  it('returns the debt and liquidity totals as BigNumbers', () => {
    expectTypeOf<ReturnType<typeof calculateReserveDebt>>().toEqualTypeOf<CalculateReserveDebtResponse>();
    expectTypeOf<CalculateReserveDebtResponse>().toEqualTypeOf<{
      totalVariableDebt: BigNumber;
      totalDebt: BigNumber;
      totalLiquidity: BigNumber;
    }>();
  });
});
