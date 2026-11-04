import { describe, expect, it } from 'vitest';
import { leveragedNetApyPct, timeToBreakevenYears } from './positionApyMath.js';

/** Supply above borrow, so levering up is worth something. */
const SUPPLY = 8;
const BORROW = 5;

describe('leveragedNetApyPct', () => {
  it('is the plain supply rate at 1x', () => {
    expect(leveragedNetApyPct(SUPPLY, BORROW, 1)).toBeCloseTo(SUPPLY, 10);
  });

  it('adds the spread once per turn of leverage', () => {
    // 2x earns supply on twice the equity and pays borrow on once: 16 - 5.
    expect(leveragedNetApyPct(SUPPLY, BORROW, 2)).toBeCloseTo(11, 10);
    expect(leveragedNetApyPct(SUPPLY, BORROW, 3)).toBeCloseTo(14, 10);
  });

  it('goes negative when borrow outruns supply', () => {
    expect(leveragedNetApyPct(2, 5, 3)).toBeLessThan(0);
  });
});

describe('timeToBreakevenYears', () => {
  const input = { costUsd: 3, equityUsd: 100, fromLeverage: 1 };

  it('charges the cost against the INCREMENTAL rate, not the headline one', () => {
    // 1x -> 2x adds 3 points, so $3 on $100 of equity takes a year. Against the headline 11% it
    // would read as 0.27 years, which is the flattering answer this exists to avoid.
    expect(timeToBreakevenYears(SUPPLY, BORROW, 2, input)).toBeCloseTo(1, 10);
  });

  it('takes longer on less equity, which is what passing the deposit instead got wrong', () => {
    const onEquity = timeToBreakevenYears(SUPPLY, BORROW, 2, { ...input, equityUsd: 95.34 });
    expect(onEquity).toBeGreaterThan(timeToBreakevenYears(SUPPLY, BORROW, 2, input) as number);
  });

  it("says 'never' when levering up does not raise the rate", () => {
    expect(timeToBreakevenYears(2, 5, 3, input)).toBe('never');
  });

  it("says 'immediate' when the quote beat parity and there is nothing to earn back", () => {
    expect(timeToBreakevenYears(SUPPLY, BORROW, 2, { ...input, costUsd: -1 })).toBe('immediate');
  });

  it('returns nothing rather than a number when there is no equity to earn on', () => {
    expect(timeToBreakevenYears(SUPPLY, BORROW, 2, { ...input, equityUsd: 0 })).toBeUndefined();
    expect(timeToBreakevenYears(SUPPLY, BORROW, 2, { ...input, costUsd: Number.NaN })).toBeUndefined();
  });

  it('measures from the CURRENT leverage on an adjust, not from 1x', () => {
    // An already-levered position earns most of the rate whether or not you adjust it.
    const fromOne = timeToBreakevenYears(SUPPLY, BORROW, 3, input) as number;
    const fromTwo = timeToBreakevenYears(SUPPLY, BORROW, 3, { ...input, fromLeverage: 2 }) as number;
    expect(fromTwo).toBeGreaterThan(fromOne);
  });
});
