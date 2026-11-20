/** Pins the result types of the hub lending pool reads. */
import { describe, expectTypeOf, it } from 'vitest';
import type { Address, ReserveDataLegacy } from '../index.js';
import type { LendingPoolService } from './LendingPoolService.js';

describe('LendingPoolService', () => {
  it('reads the reserve list, reserve data and normalized income', () => {
    expectTypeOf<ReturnType<LendingPoolService['getReservesList']>>().toEqualTypeOf<Promise<readonly Address[]>>();
    expectTypeOf<ReturnType<LendingPoolService['getReserveData']>>().toEqualTypeOf<Promise<ReserveDataLegacy>>();
    expectTypeOf<ReturnType<LendingPoolService['getReserveNormalizedIncome']>>().toEqualTypeOf<Promise<bigint>>();
  });
});
