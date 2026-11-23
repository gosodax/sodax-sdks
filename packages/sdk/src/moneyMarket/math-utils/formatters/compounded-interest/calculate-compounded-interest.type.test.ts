/** Pins the result type of the compounded-rate helper. */
import type BigNumber from 'bignumber.js';
import { describe, expectTypeOf, it } from 'vitest';
import type { calculateCompoundedRate } from './calculate-compounded-interest.js';

describe('calculateCompoundedRate', () => {
  it('returns a BigNumber', () => {
    expectTypeOf<ReturnType<typeof calculateCompoundedRate>>().toEqualTypeOf<BigNumber>();
  });
});
