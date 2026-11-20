/** Pins the result type of the user reserve totals. */
import type BigNumber from 'bignumber.js';
import { describe, expectTypeOf, it } from 'vitest';
import type { FormatReserveUSDResponse } from '../reserve/index.js';
import type { calculateUserReserveTotals } from './calculate-user-reserve-totals.js';

describe('calculateUserReserveTotals', () => {
  it('returns the raw totals', () => {
    // The response interface is not exported, so its shape is spelled out.
    expectTypeOf<ReturnType<typeof calculateUserReserveTotals>>().toEqualTypeOf<{
      totalLiquidityMarketReferenceCurrency: BigNumber;
      totalBorrowsMarketReferenceCurrency: BigNumber;
      totalCollateralMarketReferenceCurrency: BigNumber;
      currentLtv: BigNumber;
      currentLiquidationThreshold: BigNumber;
      isInIsolationMode: boolean;
      isolatedReserve?: FormatReserveUSDResponse;
    }>();
  });
});
