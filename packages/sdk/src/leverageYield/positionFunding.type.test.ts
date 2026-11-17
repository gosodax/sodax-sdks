/** Compile-time contract: the position funding address resolver returns a string for every chain. */
import { describe, expectTypeOf, it } from 'vitest';
import type { resolvePositionFundingAddress } from './positionFunding.js';

describe('positionFunding result types', () => {
  it('resolvePositionFundingAddress → string', () => {
    expectTypeOf<ReturnType<typeof resolvePositionFundingAddress>>().toEqualTypeOf<string>();
  });
});
