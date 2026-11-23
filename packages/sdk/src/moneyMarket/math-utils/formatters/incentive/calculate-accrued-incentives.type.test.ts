/** Pins the result type of the accrued-incentives calculation. */
import type BigNumber from 'bignumber.js';
import { describe, expectTypeOf, it } from 'vitest';
import type { calculateAccruedIncentives } from './calculate-accrued-incentives.js';

describe('calculateAccruedIncentives', () => {
  it('returns a BigNumber', () => {
    expectTypeOf<ReturnType<typeof calculateAccruedIncentives>>().toEqualTypeOf<BigNumber>();
  });
});
