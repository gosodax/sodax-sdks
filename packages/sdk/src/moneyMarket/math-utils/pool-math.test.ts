import { describe, expect, it } from 'vitest';
import { calculateCompoundedInterest, getReserveNormalizedIncome } from './pool-math.js';
import { RAY } from './ray.math.js';

const RATE = '50000000000000000000000000'; // 5% APY in RAY
const INDEX = '1500000000000000000000000000'; // 1.5 in RAY

describe('calculateCompoundedInterest — negative timeDelta clamp', () => {
  it('returns RAY (no accrual) when currentTimestamp is behind (client clock behind chain) or equal', () => {
    const cases = [
      ['behind', 1_000 + 31_536_000],
      ['equal', 1_000],
    ] as const;
    for (const [label, lastUpdateTimestamp] of cases) {
      const result = calculateCompoundedInterest({ rate: RATE, currentTimestamp: 1_000, lastUpdateTimestamp });
      expect(result.toString(), label).toBe(RAY.toString());
    }
  });

  it('accrues interest (> RAY) when time elapses forward', () => {
    const result = calculateCompoundedInterest({
      rate: RATE,
      currentTimestamp: 1_000 + 31_536_000,
      lastUpdateTimestamp: 1_000,
    });
    expect(result.gt(RAY)).toBe(true);
  });
});

describe('getReserveNormalizedIncome — negative timeDelta preserves index', () => {
  it('returns the existing index unchanged when the client clock is behind chain', () => {
    const result = getReserveNormalizedIncome({
      rate: RATE,
      index: INDEX,
      currentTimestamp: 1_000,
      lastUpdateTimestamp: 1_000 + 31_536_000,
    });
    expect(result.eq(INDEX)).toBe(true);
  });

  it('grows the index for forward time', () => {
    const result = getReserveNormalizedIncome({
      rate: RATE,
      index: INDEX,
      currentTimestamp: 1_000 + 31_536_000,
      lastUpdateTimestamp: 1_000,
    });
    expect(result.gt(INDEX)).toBe(true);
  });
});
