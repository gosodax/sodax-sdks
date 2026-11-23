/** Compile-time contract for `estimateSwapSpeedTier`: a closed tier label plus the seconds estimate. */
import { describe, expectTypeOf, it } from 'vitest';
import type { SwapSpeedTierResult } from '../index.js';
import { estimateSwapSpeedTier } from './speed-tier.js';

describe('estimateSwapSpeedTier', () => {
  it('returns the tier result', () => {
    expectTypeOf(estimateSwapSpeedTier).returns.toEqualTypeOf<SwapSpeedTierResult>();
    expectTypeOf<SwapSpeedTierResult>().toEqualTypeOf<{ tier: 'fast' | 'normal' | 'slow'; estimatedSeconds: number }>();
  });
});
