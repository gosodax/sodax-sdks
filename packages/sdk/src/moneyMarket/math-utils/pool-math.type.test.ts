/** Pins the result types of the pool interest, balance and health-factor math. */
import type BigNumber from 'bignumber.js';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  calculateAvailableBorrowsMarketReferenceCurrency,
  calculateCompoundedInterest,
  calculateHealthFactorFromBalances,
  calculateHealthFactorFromBalancesBigUnits,
  calculateLinearInterest,
  getCompoundedBalance,
  getLinearBalance,
  getMarketReferenceCurrencyAndUsdBalance,
  getReserveNormalizedIncome,
} from './pool-math.js';

describe('pool math', () => {
  it('interest and balance helpers return a BigNumber', () => {
    expectTypeOf<ReturnType<typeof calculateCompoundedInterest>>().toEqualTypeOf<BigNumber>();
    expectTypeOf<ReturnType<typeof getCompoundedBalance>>().toEqualTypeOf<BigNumber>();
    expectTypeOf<ReturnType<typeof calculateLinearInterest>>().toEqualTypeOf<BigNumber>();
    expectTypeOf<ReturnType<typeof getReserveNormalizedIncome>>().toEqualTypeOf<BigNumber>();
    expectTypeOf<ReturnType<typeof getLinearBalance>>().toEqualTypeOf<BigNumber>();
  });

  it('health factor and borrow capacity helpers return a BigNumber', () => {
    expectTypeOf<ReturnType<typeof calculateHealthFactorFromBalances>>().toEqualTypeOf<BigNumber>();
    expectTypeOf<ReturnType<typeof calculateHealthFactorFromBalancesBigUnits>>().toEqualTypeOf<BigNumber>();
    expectTypeOf<ReturnType<typeof calculateAvailableBorrowsMarketReferenceCurrency>>().toEqualTypeOf<BigNumber>();
  });

  it('getMarketReferenceCurrencyAndUsdBalance returns both raw balances', () => {
    // The response interface is not exported, so its shape is spelled out.
    expectTypeOf<ReturnType<typeof getMarketReferenceCurrencyAndUsdBalance>>().toEqualTypeOf<{
      marketReferenceCurrencyBalance: BigNumber;
      usdBalance: BigNumber;
    }>();
  });
});
