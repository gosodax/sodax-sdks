/** Compile-time contract: the leverage sizing helpers return their named sizing and projection shapes. */
import { describe, expectTypeOf, it } from 'vitest';
import type { LeverageBorrowSizing, LeverageLegProjection } from '../index.js';
import type { projectLeverageLeg, sizeLeverageBorrow } from './positionSizing.js';

describe('positionSizing result types', () => {
  it('sizeLeverageBorrow → LeverageBorrowSizing', () => {
    expectTypeOf<ReturnType<typeof sizeLeverageBorrow>>().toEqualTypeOf<LeverageBorrowSizing>();
  });

  it('projectLeverageLeg → LeverageLegProjection', () => {
    expectTypeOf<ReturnType<typeof projectLeverageLeg>>().toEqualTypeOf<LeverageLegProjection>();
  });
});
