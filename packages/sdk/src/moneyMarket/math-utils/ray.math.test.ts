import BigNumber from 'bignumber.js';
import { describe, expect, it } from 'vitest';
import { RAY, binomialApproximatedRayPow } from './ray.math.js';

describe('binomialApproximatedRayPow — negative/zero exponent guard', () => {
  // ~5% APY expressed in RAY, divided by seconds-per-year → per-second rate.
  const ratePerSecond = new BigNumber('50000000000000000000000000').dividedBy(31_536_000);

  it('returns RAY when the exponent is negative (clock skew must not produce garbage)', () => {
    // A negative timeDelta (client clock behind chain block.timestamp) previously fed the
    // binomial expansion and returned a wrong value. It must clamp to RAY (no accrual).
    expect(binomialApproximatedRayPow(ratePerSecond, -31_536_000).toString()).toBe(RAY.toString());
  });
});
