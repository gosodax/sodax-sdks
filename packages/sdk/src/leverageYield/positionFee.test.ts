import { describe, expect, it } from 'vitest';
import { MAX_POSITION_FEE_BPS, Sodax } from '../index.js';
import { expectErr, expectOk } from '../test-utils/result.js';

const FEE_RECEIVER = '0x4444444444444444444444444444444444444444' as const;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/** `leverageYield.partnerFee` wins, then the global `fee`, then none. */
const sodaxWith = (fee?: { address: `0x${string}`; percentage: number }) => new Sodax(fee ? { fee } : undefined);

describe('getEffectivePositionFee', () => {
  it('is zero with no fee configured, so a projection without it is still right', () => {
    expect(expectOk(sodaxWith().leverageYield.getEffectivePositionFee()).feeBps).toBe(0);
  });

  it('reports the configured fee, which is what a caller cannot derive on its own', () => {
    const result = sodaxWith({ address: FEE_RECEIVER, percentage: 50 }).leverageYield.getEffectivePositionFee();
    expect(expectOk(result)).toEqual({ feeReceiver: FEE_RECEIVER, feeBps: 50 });
  });

  it('lets a per-call override win, matching what the open call will bake in', () => {
    const sodax = sodaxWith({ address: FEE_RECEIVER, percentage: 50 });
    const result = sodax.leverageYield.getEffectivePositionFee({ address: FEE_RECEIVER, percentage: 10 });
    expect(expectOk(result).feeBps).toBe(10);
  });

  it('refuses a fee the position cannot be created with', () => {
    // `PositionConfig.feeBps` is a uint16 fixed at creation; a bad value is not mispriced once, it is
    // wrong for the life of the position. `LeveragePosition.initialize` also reverts `InvalidAddress`
    // unless `feeBps` and `feeReceiver` are both set or both empty, which would land after funds moved.
    const sodax = sodaxWith();
    const unexpressible = [
      ['a fractional fee', { address: FEE_RECEIVER, percentage: 0.5 }],
      ['a negative fee', { address: FEE_RECEIVER, percentage: -1 }],
      ['the fixed-amount variant', { address: FEE_RECEIVER, amount: 1000n }],
    ] as const;
    for (const [label, fee] of unexpressible)
      expectErr(sodax.leverageYield.getEffectivePositionFee(fee), undefined, undefined, label);

    const halfSet = [
      ['a receiver with no rate', { address: FEE_RECEIVER, percentage: 0 }],
      ['a rate with no receiver', { address: ZERO_ADDRESS, percentage: 50 }],
    ] as const;
    for (const [label, fee] of halfSet) {
      expectErr(sodax.leverageYield.getEffectivePositionFee(fee), 'LOOKUP_FAILED', undefined, label);
    }
  });

  /**
   * The documented position cap is 1%, not `FEE_PERCENTAGE_SCALE` — a fee is permanent here, so a
   * mistaken 10% would be charged on every operation the position ever runs.
   */
  it('caps the leverageYield.partnerFee config at MAX_POSITION_FEE_BPS', () => {
    const resolve = (pct: number) =>
      new Sodax({
        leverageYield: { partnerFee: { address: FEE_RECEIVER, percentage: pct } },
      }).leverageYield.getEffectivePositionFee();
    expect(expectOk(resolve(MAX_POSITION_FEE_BPS)).feeBps).toBe(MAX_POSITION_FEE_BPS);
    expect(expectErr(resolve(MAX_POSITION_FEE_BPS + 1), 'LOOKUP_FAILED').message).toContain('MAX_POSITION_FEE_BPS');
  });

  /** Both empty is the unpartnered position, and stays valid. */
  it('still accepts no receiver and no rate together', () => {
    const result = sodaxWith().leverageYield.getEffectivePositionFee({ address: ZERO_ADDRESS, percentage: 0 });
    expect(expectOk(result).feeBps).toBe(0);
  });
});
