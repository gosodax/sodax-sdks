/** Pins the result type of the incentive APR calculation. */
import { describe, expectTypeOf, it } from 'vitest';
import type { calculateIncentiveAPR } from './calculate-incentive-apr.js';

describe('calculateIncentiveAPR', () => {
  it('returns a decimal string', () => {
    expectTypeOf<ReturnType<typeof calculateIncentiveAPR>>().toEqualTypeOf<string>();
  });
});
