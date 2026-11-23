/** Compile-time contract: the position APY helpers return plain numbers, breakeven adds its sentinels. */
import { describe, expectTypeOf, it } from 'vitest';
import type { leveragedNetApyPct, timeToBreakevenYears } from './positionApyMath.js';

describe('positionApyMath result types', () => {
  it('leveragedNetApyPct → number', () => {
    expectTypeOf<ReturnType<typeof leveragedNetApyPct>>().toEqualTypeOf<number>();
  });

  it("timeToBreakevenYears → number | 'never' | 'immediate' | undefined", () => {
    expectTypeOf<ReturnType<typeof timeToBreakevenYears>>().toEqualTypeOf<number | 'never' | 'immediate' | undefined>();
  });
});
