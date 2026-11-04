import { describe, expect, it } from 'vitest';
import { MAX_POSITION_FEE_BPS, Sodax } from '../index.js';

const FEE_RECEIVER = '0x4444444444444444444444444444444444444444' as const;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/** `leverageYield.partnerFee` wins, then the global `fee`, then none. */
const sodaxWith = (fee?: { address: `0x${string}`; percentage: number }) => new Sodax(fee ? { fee } : undefined);

describe('getEffectivePositionFee', () => {
  it('is zero with no fee configured, so a projection without it is still right', () => {
    const result = sodaxWith().leverageYield.getEffectivePositionFee();
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.feeBps).toBe(0);
  });

  it('reports the configured fee, which is what a caller cannot derive on its own', () => {
    const result = sodaxWith({ address: FEE_RECEIVER, percentage: 50 }).leverageYield.getEffectivePositionFee();
    expect(result.ok && result.value).toEqual({ feeReceiver: FEE_RECEIVER, feeBps: 50 });
  });

  it('lets a per-call override win, matching what the open call will bake in', () => {
    const sodax = sodaxWith({ address: FEE_RECEIVER, percentage: 50 });
    const result = sodax.leverageYield.getEffectivePositionFee({ address: FEE_RECEIVER, percentage: 10 });
    expect(result.ok && result.value.feeBps).toBe(10);
  });

  it('refuses a fractional or out-of-range fee rather than baking one in permanently', () => {
    // `PositionConfig.feeBps` is a uint16 fixed at creation; a bad value is not mispriced once, it is
    // wrong for the life of the position.
    const sodax = sodaxWith();
    expect(sodax.leverageYield.getEffectivePositionFee({ address: FEE_RECEIVER, percentage: 0.5 }).ok).toBe(false);
    expect(sodax.leverageYield.getEffectivePositionFee({ address: FEE_RECEIVER, percentage: -1 }).ok).toBe(false);
  });

  /**
   * The documented position cap is 1%, not `FEE_PERCENTAGE_SCALE` — a fee is permanent here, so a
   * mistaken 10% would be charged on every operation the position ever runs. Checked on all three
   * sources because each reaches `resolvePositionFee` by its own route.
   */
  it.each([
    [
      'a per-call override',
      (pct: number) => sodaxWith().leverageYield.getEffectivePositionFee({ address: FEE_RECEIVER, percentage: pct }),
    ],
    [
      'the leverageYield.partnerFee config',
      (pct: number) =>
        new Sodax({
          leverageYield: { partnerFee: { address: FEE_RECEIVER, percentage: pct } },
        }).leverageYield.getEffectivePositionFee(),
    ],
    [
      'the global fee config',
      (pct: number) => sodaxWith({ address: FEE_RECEIVER, percentage: pct }).leverageYield.getEffectivePositionFee(),
    ],
  ])('caps %s at MAX_POSITION_FEE_BPS', (_source, resolve) => {
    const accepted = resolve(MAX_POSITION_FEE_BPS);
    expect(accepted.ok).toBe(true);
    expect(accepted.ok && accepted.value.feeBps).toBe(MAX_POSITION_FEE_BPS);

    const rejected = resolve(MAX_POSITION_FEE_BPS + 1);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.code).toBe('LOOKUP_FAILED');
    expect(rejected.error.message).toContain('MAX_POSITION_FEE_BPS');
  });

  /**
   * `LeveragePosition.initialize` reverts `InvalidAddress` unless `feeBps` and `feeReceiver` are both
   * set or both empty. Caught here because the revert would otherwise land after the funds have moved.
   */
  it.each([
    ['a receiver with no rate', { address: FEE_RECEIVER, percentage: 0 }],
    ['a rate with no receiver', { address: ZERO_ADDRESS, percentage: 50 }],
  ])('refuses %s, which the position rejects on creation', (_case, partnerFee) => {
    const result = sodaxWith().leverageYield.getEffectivePositionFee(partnerFee);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LOOKUP_FAILED');
  });

  /** Both empty is the unpartnered position, and stays valid. */
  it('still accepts no receiver and no rate together', () => {
    const result = sodaxWith().leverageYield.getEffectivePositionFee({ address: ZERO_ADDRESS, percentage: 0 });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.feeBps).toBe(0);
  });

  it('refuses the fixed-amount fee variant, which PositionConfig cannot express', () => {
    const sodax = sodaxWith();
    expect(sodax.leverageYield.getEffectivePositionFee({ address: FEE_RECEIVER, amount: 1000n }).ok).toBe(false);
  });
});
