import { describe, expect, it } from 'vitest';
import { parseUnits } from 'viem';
import {
  type LeverageLegRequest,
  type PositionSide,
  projectLeverageLeg,
  sizeLeverageBorrow,
} from './positionSizing.js';

/**
 * The sUSDS / USSD loop these were derived from: an 18-decimal collateral reserve at ~1.07 and an
 * 18-decimal debt reserve at ~1.00, in eMode 3 (ltv 91%, liquidation threshold 97%).
 */
const RISK = { ltv: 0.91, liquidationThreshold: 0.97 };
const COLLATERAL_PRICE = 1.07;
const BORROW_PRICE = 1.0;

function request(overrides: Partial<LeverageLegRequest> = {}): LeverageLegRequest {
  return {
    side: 'collateral',
    deposit: parseUnits('1', 18),
    depositDecimals: 18,
    collateralPriceUsd: COLLATERAL_PRICE,
    borrowPriceUsd: BORROW_PRICE,
    borrowDecimals: 18,
    leverage: 2,
    ...overrides,
  };
}

describe('sizeLeverageBorrow', () => {
  it('borrows equity x (leverage - 1), priced off the collateral on a collateral-side open', () => {
    const sized = sizeLeverageBorrow(request({ leverage: 3 }));
    // 1 sUSDS at 1.07 is $1.07 of equity; 3x needs $2.14 of debt, which at $1 is 2.14 tokens.
    expect(sized.depositUsd).toBeCloseTo(1.07, 10);
    expect(sized.borrowUsd).toBeCloseTo(2.14, 10);
    expect(sized.borrowAmount).toBe(parseUnits('2.14', 18));
    // Nothing of the user's own goes to the solver on this side.
    expect(sized.intentInput).toBe(sized.borrowAmount);
  });

  it('prices the deposit with the DEBT token on a debt-side open, and adds it to the solver input', () => {
    const sized = sizeLeverageBorrow(request({ side: 'debt', leverage: 3 }));
    // The deposit is USSD here, so $1.00 — not $1.07. Using the collateral price overstated the
    // deposit by the whole pair spread, which is one half of the reported AAVE 36 failure.
    expect(sized.depositUsd).toBeCloseTo(1.0, 10);
    expect(sized.borrowAmount).toBe(parseUnits('2', 18));
    // The contribution is handed to the solver too: the debt-side hook is paid both.
    expect(sized.intentInput).toBe(parseUnits('3', 18));
  });

  /**
   * The regression a static review caught and every existing test missed: they all used 18-decimal
   * inputs on both sides, so the decimal gap could not show up.
   */
  it('rescales a non-18-decimal debt-side contribution into the borrow reserve units', () => {
    const sized = sizeLeverageBorrow(
      request({ side: 'debt', leverage: 3, deposit: parseUnits('100', 6), depositDecimals: 6 }),
    );
    // 100 USDC of equity at $1 borrows 200 of an 18-decimal reserve...
    expect(sized.borrowAmount).toBe(parseUnits('200', 18));
    // ...and the intent input is 300 in RESERVE units, not 200 + 1e8.
    expect(sized.intentInput).toBe(parseUnits('300', 18));
  });

  it('leaves a matching-decimal contribution untouched', () => {
    const sized = sizeLeverageBorrow(request({ side: 'debt', leverage: 3 }));
    expect(sized.intentInput).toBe(parseUnits('3', 18));
  });

  it('borrows nothing at 1x, and never a negative amount below it', () => {
    expect(sizeLeverageBorrow(request({ leverage: 1 })).borrowAmount).toBe(0n);
    expect(sizeLeverageBorrow(request({ leverage: 0.5 })).borrowAmount).toBe(0n);
  });
});

describe('projectLeverageLeg', () => {
  /** A quote that pays `ratio` x the input's oracle value, in collateral tokens. */
  const quoteAt = (intentInputUsd: number, ratio: number) => ({
    quotedCollateral: parseUnits(((intentInputUsd * ratio) / COLLATERAL_PRICE).toFixed(18), 18),
    collateralDecimals: 18,
  });

  it('takes the floor off the QUOTE, not off the input', () => {
    const req = request({ leverage: 3 });
    const quote = quoteAt(2.14, 1);
    const { minCollateralOut } = projectLeverageLeg(req, quote, RISK, 1);
    expect(minCollateralOut).toBe((quote.quotedCollateral * 9900n) / 10_000n);
  });

  it('never posts a zero floor', () => {
    const req = request({ leverage: 3 });
    const { minCollateralOut } = projectLeverageLeg(req, { quotedCollateral: 1n, collateralDecimals: 18 }, RISK, 1);
    expect(minCollateralOut).toBe(1n);
  });

  it('counts the deposit as collateral on a collateral-side open but NOT on a debt-side one', () => {
    const collateralSide = projectLeverageLeg(request({ leverage: 3 }), quoteAt(2.14, 1), RISK, 0);
    // $1.07 supplied + $2.14 bought.
    expect(collateralSide.collateralUsd).toBeCloseTo(3.21, 6);

    const debtSide = projectLeverageLeg(request({ side: 'debt', leverage: 3 }), quoteAt(3, 1), RISK, 0);
    // Only what the solver delivered: the $1 contribution went to the solver, it was not supplied.
    expect(debtSide.collateralUsd).toBeCloseTo(3.0, 6);
    expect(debtSide.debtUsd).toBeCloseTo(2.0, 6);
  });

  /**
   * THE REGRESSION THAT MATTERS. A debt-side open at 11.03x with a ~1.2% haircut: oracle parity put
   * the LTV at ~84% and it was really 92.06% against a 91% cap, so the borrow reverted with '36'
   * after the solver had already filled.
   */
  it('reports the real LTV on a debt-side open, and flags the AAVE 36 boundary parity misses', () => {
    const req = request({ side: 'debt', leverage: 11.03 });
    const projection = projectLeverageLeg(req, quoteAt(11.03, 0.9877), RISK, 0);

    // debt/collateral = (L-1) / (L x f), which parity (f = 1) would report as 10.03/11.03 = 90.9%.
    expect(projection.ltv).toBeCloseTo(10.03 / (11.03 * 0.9877), 4);
    expect(projection.ltv).toBeGreaterThan(RISK.ltv);
    expect(projection.exceedsMaxLtv).toBe(true);
    // And it says how far it could have gone: `1 / (1 - 0.91 x 0.9877)`.
    expect(projection.usableMaxLeverage).toBeCloseTo(1 / (1 - RISK.ltv * 0.9877), 4);
    expect(projection.usableMaxLeverage).toBeLessThan(11.03);
  });

  it('a leg sized at the usable max is accepted, and one step past it is not', () => {
    const at = projectLeverageLeg(request({ side: 'debt', leverage: 9.88 }), quoteAt(9.88, 0.9877), RISK, 0);
    expect(at.exceedsMaxLtv).toBe(false);
    const past = projectLeverageLeg(request({ side: 'debt', leverage: 10.5 }), quoteAt(10.5, 0.9877), RISK, 0);
    expect(past.exceedsMaxLtv).toBe(true);
  });

  /**
   * The branch the review flagged: past `f = 1 / ltv` each turn adds more borrowing power than debt,
   * so there is no ceiling. This used to report `1` — "no leverage possible" — at the most favourable
   * prices, and got there by a discontinuous drop from ~10^6.
   */
  it('reports no ceiling once the fill is favourable enough to be self-financing', () => {
    const justUnder = projectLeverageLeg(request({ side: 'debt', leverage: 2 }), quoteAt(2, 1.09), RISK, 0);
    expect(Number.isFinite(justUnder.usableMaxLeverage)).toBe(true);
    expect(justUnder.usableMaxLeverage).toBeGreaterThan(11);

    // ltv 0.91 x f 1.15 = 1.0465, past the 1/0.91 crossing.
    for (const side of ['debt', 'collateral'] as const) {
      const past = projectLeverageLeg(request({ side, leverage: 2 }), quoteAt(2, 1.15), RISK, 0);
      expect(past.usableMaxLeverage).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it('reports a ceiling of 1 when borrowing is disabled outright', () => {
    const projection = projectLeverageLeg(request({ leverage: 2 }), quoteAt(1.07, 1), { ...RISK, ltv: 0 }, 0);
    expect(projection.usableMaxLeverage).toBe(1);
  });

  it('collapses to the textbook ceiling when the solver takes nothing', () => {
    const collateralSide = projectLeverageLeg(request({ leverage: 2 }), quoteAt(1.07, 1), RISK, 0);
    // 1 + ltv/(1 - ltv) === 1/(1 - ltv) at f = 1.
    expect(collateralSide.usableMaxLeverage).toBeCloseTo(1 / (1 - RISK.ltv), 6);
    const debtSide = projectLeverageLeg(request({ side: 'debt', leverage: 2 }), quoteAt(2, 1), RISK, 0);
    expect(debtSide.usableMaxLeverage).toBeCloseTo(1 / (1 - RISK.ltv), 6);
  });

  it('measures the haircut from the quote, and reports a negative one when the quote beats parity', () => {
    const worse = projectLeverageLeg(request({ leverage: 3 }), quoteAt(2.14, 0.99), RISK, 0);
    expect(worse.haircut).toBeCloseTo(0.01, 6);
    const better = projectLeverageLeg(request({ leverage: 3 }), quoteAt(2.14, 1.005), RISK, 0);
    expect(better.haircut).toBeCloseTo(-0.005, 6);
  });

  it('slippage widens the gap between the floor and the quote without moving the haircut', () => {
    const req = request({ leverage: 3 });
    const quote = quoteAt(2.14, 0.99);
    const tight = projectLeverageLeg(req, quote, RISK, 0.5);
    const loose = projectLeverageLeg(req, quote, RISK, 5);
    // The haircut is the expected cost, so tolerance does not change it...
    expect(loose.haircut).toBeCloseTo(tight.haircut, 10);
    // ...but the projection is from the floor, so a looser tolerance is a worse projected position.
    expect(loose.minCollateralOut).toBeLessThan(tight.minCollateralOut);
    expect(loose.ltv).toBeGreaterThan(tight.ltv);
    expect(loose.usableMaxLeverage).toBeLessThan(tight.usableMaxLeverage);
  });

  // ─── Partner fee ────────────────────────────────────────────────────────────
  //
  // The fee is borrowed ON TOP of what the solver is paid (`LeveragePosition._feeFor` over the
  // intent input, required by the hooks as `inputAmount + fee`), so it is debt against unchanged
  // collateral. These pin that down, because projecting without it is an Aave '36' at a leverage the
  // caller was told was safe.

  it('charges the fee over the intent input, matching the contract formula', () => {
    const collateralSide = sizeLeverageBorrow(request({ leverage: 3, feeBps: 50 }));
    // Input is the borrow alone here: 2.14 x 50bp.
    expect(collateralSide.feeAmount).toBe((collateralSide.borrowAmount * 50n) / 10_000n);

    const debtSide = sizeLeverageBorrow(request({ side: 'debt', leverage: 3, feeBps: 50 }));
    // Input includes the user's own contribution, so the fee is on 3 units, not 2.
    expect(debtSide.intentInput).toBe(parseUnits('3', 18));
    expect(debtSide.feeAmount).toBe((parseUnits('3', 18) * 50n) / 10_000n);
  });

  it('adds the fee to debt without changing what the solver is paid', () => {
    const free = sizeLeverageBorrow(request({ leverage: 3 }));
    const paid = sizeLeverageBorrow(request({ leverage: 3, feeBps: 50 }));
    expect(paid.borrowAmount).toBe(free.borrowAmount);
    expect(paid.borrowUsd).toBeCloseTo(free.borrowUsd, 10);
    expect(paid.debtUsd).toBeGreaterThan(free.debtUsd);
    expect(paid.debtUsd).toBeCloseTo(free.borrowUsd * 1.005, 6);
  });

  it('projects the higher LTV, and the ceiling shrinks by the closed form', () => {
    const quote = quoteAt(2.14, 0.9877);
    const free = projectLeverageLeg(request({ leverage: 3 }), quote, RISK, 0);
    const paid = projectLeverageLeg(request({ leverage: 3, feeBps: 50 }), quote, RISK, 0);

    expect(paid.debtUsd).toBeGreaterThan(free.debtUsd);
    expect(paid.ltv).toBeGreaterThan(free.ltv);
    expect(paid.usableMaxLeverage).toBeLessThan(free.usableMaxLeverage);

    // 1 + ltv / (1 + phi - ltv.f) on the collateral side.
    const f = free.collateralUsd > 0 ? (free.collateralUsd - 1.07) / free.inputUsd : 0;
    expect(paid.usableMaxLeverage).toBeCloseTo(1 + RISK.ltv / (1 + 0.005 - RISK.ltv * f), 4);
  });

  it('a fee can push a leverage that was acceptable over the max-LTV line', () => {
    const quote = quoteAt(9.6, 0.9877);
    const req = { side: 'debt', leverage: 9.6 } as const;
    const free = projectLeverageLeg(request(req), quote, RISK, 0);
    const paid = projectLeverageLeg(request({ ...req, feeBps: 100 }), quote, RISK, 0);
    expect(free.exceedsMaxLtv).toBe(false);
    expect(paid.exceedsMaxLtv).toBe(true);
  });

  it('is byte-for-byte the fee-free result when no fee is configured', () => {
    for (const side of ['collateral', 'debt'] as const) {
      const omitted = projectLeverageLeg(request({ side, leverage: 3 }), quoteAt(3, 0.99), RISK, 1);
      const zero = projectLeverageLeg(request({ side, leverage: 3, feeBps: 0 }), quoteAt(3, 0.99), RISK, 1);
      expect(zero).toEqual(omitted);
      expect(sizeLeverageBorrow(request({ side, leverage: 3, feeBps: 0 })).feeAmount).toBe(0n);
    }
  });

  it('counts the partner fee as part of the one-time cost a breakeven has to repay', () => {
    const quote = quoteAt(2.14, 0.99);
    const free = projectLeverageLeg(request({ leverage: 3 }), quote, RISK, 0);
    const paid = projectLeverageLeg(request({ leverage: 3, feeBps: 50 }), quote, RISK, 0);
    // Same solver haircut, but the owner owes the fee on top without receiving anything for it.
    expect(paid.haircut).toBeCloseTo(free.haircut, 10);
    expect(paid.costUsd).toBeCloseTo(free.costUsd + 2.14 * 0.005, 6);
  });

  it('the unbounded crossing moves with the fee', () => {
    // ltv.f = 1.0465 is past 1 but NOT past 1 + phi once the fee is 100bp... it is 1.01, so still
    // unbounded; at f = 1.10 (ltv.f = 1.001) a 100bp fee pulls it back to finite.
    const feeFree = projectLeverageLeg(request({ side: 'debt', leverage: 2 }), quoteAt(2, 1.1), RISK, 0);
    expect(feeFree.usableMaxLeverage).toBe(Number.POSITIVE_INFINITY);
    const withFee = projectLeverageLeg(request({ side: 'debt', leverage: 2, feeBps: 100 }), quoteAt(2, 1.1), RISK, 0);
    expect(Number.isFinite(withFee.usableMaxLeverage)).toBe(true);
  });

  it('reports an infinite health factor when nothing is borrowed', () => {
    const projection = projectLeverageLeg(request({ leverage: 1 }), quoteAt(0, 1), RISK, 1);
    expect(projection.healthFactor).toBe(Number.POSITIVE_INFINITY);
    expect(projection.exceedsMaxLtv).toBe(false);
  });

  it('health factor crosses 1 exactly where debt reaches the liquidation threshold', () => {
    const projection = projectLeverageLeg(request({ leverage: 3 }), quoteAt(2.14, 1), RISK, 0);
    // collateral 3.21 x 0.97 / debt 2.14
    expect(projection.healthFactor).toBeCloseTo((3.21 * 0.97) / 2.14, 6);
    expect(projection.healthFactor).toBeGreaterThan(1);
  });
});

/** A quote keeping exactly `haircut` of what it is handed, so that is the only variable below. */
const SCALE = 1_000_000_000n;
function quoteAtHaircut(intentInput: bigint, haircut: number) {
  return {
    quotedCollateral: (intentInput * BigInt(Math.round((1 - haircut) * Number(SCALE)))) / SCALE,
    collateralDecimals: 18,
  };
}

/** Prices at parity so USD and tokens coincide. */
function parityRequest(overrides: Partial<LeverageLegRequest> = {}): LeverageLegRequest {
  return request({ collateralPriceUsd: 1, borrowPriceUsd: 1, ...overrides });
}

/** The caller's whole loop. */
function openAt(side: PositionSide, leverage: number, haircut: number, slippagePct = 0) {
  const req = parityRequest({ side, leverage });
  const sized = sizeLeverageBorrow(req);
  return projectLeverageLeg(req, quoteAtHaircut(sized.intentInput, haircut), RISK, slippagePct);
}

describe('exposureLeverage', () => {
  it('equals the requested leverage when the solver keeps nothing', () => {
    // With no haircut the deposit IS the equity, which is what `leverage` is sized under.
    expect(openAt('collateral', 2, 0).exposureLeverage).toBeCloseTo(2, 9);
    expect(openAt('debt', 2, 0).exposureLeverage).toBeCloseTo(2, 9);
    expect(openAt('collateral', 5, 0).exposureLeverage).toBeCloseTo(5, 9);
  });

  it('reproduces the mainnet 2.00x open that reported 2.0488x', () => {
    // Sonic 0xBb6c8Cc3: $0.10763467 in, the same borrowed, $0.10262232 back — all of it off equity.
    const projection = openAt('collateral', 2, 0.04657);
    expect(projection.haircut).toBeCloseTo(0.04657, 9);
    expect(projection.exposureLeverage).toBeCloseTo(2.0488, 4);
  });

  it('overshoots in one direction only, and further the more leverage amplifies it', () => {
    // Equity is 1/L of the position, so the same haircut moves it L times as far.
    for (const leverage of [1.5, 2, 3, 5]) {
      expect(openAt('collateral', leverage, 0.02).exposureLeverage).toBeGreaterThan(leverage);
    }
    const gapAt2 = openAt('collateral', 2, 0.02).exposureLeverage - 2;
    const gapAt5 = openAt('collateral', 5, 0.02).exposureLeverage - 5;
    expect(gapAt5).toBeGreaterThan(gapAt2);
  });

  it('is Infinity when the floor leaves no equity behind', () => {
    // Unopenable, but it must not read as a negative — that looks deleveraged.
    expect(openAt('collateral', 2, 1).exposureLeverage).toBe(Number.POSITIVE_INFINITY);
  });

  it('reads above the fill once slippage widens the floor it is measured at', () => {
    // The demo posts at 1%, so what it shows is the worst permitted fill, not the expected one.
    const atFloor = openAt('collateral', 2, 0.04657, 1).exposureLeverage;
    expect(atFloor).toBeGreaterThan(openAt('collateral', 2, 0.04657).exposureLeverage);
    expect(atFloor).toBeCloseTo(2.0594, 4);
  });
});
