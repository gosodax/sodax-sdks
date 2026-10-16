/**
 * Sizing a leverage position's swap leg.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT OPTIONAL. A position's leverage is bought through the solver, and
 * the two legs do not trade at their oracle ratio. `LeverageHook` supplies whatever the solver
 * actually paid and only *then* borrows against it, so the pool's health check at fill time sees
 * `deposit + solver output`, never `deposit x leverage`. Size the leg from oracle prices and the
 * borrow reverts with Aave error `'36'` (COLLATERAL_CANNOT_COVER_NEW_BORROW) — the intent is accepted,
 * the solver fills, and the whole fill unwinds. That is not a hypothetical, it happened twice on
 * mainnet, and the two failures had different causes worth keeping apart:
 *
 *   - counting a debt-side deposit as collateral as well as handing it to the solver, which put an
 *     11.03x open at a projected 84% LTV;
 *   - pricing the solver's output at oracle parity, which put the same open at 90.9% when the real
 *     figure was 92.06% against a 91% cap.
 *
 * `side` addresses the first and `f` the second.
 *
 * So sizing is a two-phase thing, and both phases are here:
 *
 *   1. {@link sizeLeverageBorrow} — how much to borrow for a target leverage. Oracle-priced, because
 *      there is nothing else to go on yet. Quote THIS amount.
 *   2. {@link projectLeverageLeg} — given that quote, the slippage floor, what the position really
 *      looks like at that floor, and the highest leverage the quote actually supports.
 *
 * Everything in phase 2 is projected from the FLOOR rather than the quote, deliberately: the floor is
 * the worst fill the intent permits, so if the floor is safe every fill is. Projecting from the quote
 * leaves the slippage tolerance as unmodelled headroom, which is exactly the gap that failed.
 *
 * Prices are the pool oracle's, in its base currency; any consistent unit works since only ratios
 * matter. Rates and LTVs are fractions, not percentages.
 */

import { formatUnits } from 'viem';

/** Which asset the user is funding with. */
export type PositionSide = 'collateral' | 'debt';

export type LeverageLegRequest = {
  /**
   * `'collateral'` funds with the collateral asset, which is supplied. `'debt'` funds with the debt
   * asset, which is NOT supplied — it is handed to the solver as part of the intent's input, so the
   * only collateral the position ends up with is what the solver delivers. Counting the deposit on
   * both sides is what produced the 84%-vs-92.06% miss.
   */
  side: PositionSide;
  /** Deposit in its own token decimals — the collateral token or the debt token, per `side`. */
  deposit: bigint;
  depositDecimals: number;
  collateralPriceUsd: number;
  borrowPriceUsd: number;
  borrowDecimals: number;
  /**
   * Target leverage as a multiple of the DEPOSIT, not of equity. 1 borrows nothing.
   *
   * The pool books the borrow in full while the collateral arrives short by the haircut, so equity
   * ends up under the deposit and the open position reports MORE than this — always more, never
   * less. See {@link LeverageLegProjection.exposureLeverage}.
   */
  leverage: number;
  /**
   * Partner fee in basis points, as configured on the position (`PositionConfig.feeBps`). Omit or 0
   * when the position charges none.
   *
   * IT IS NOT A CUT OF THE OUTPUT. The hooks require `inputAmount + fee` and `Intents` pays the
   * receiver on the fill, so on a leverage-up the position borrows the fee ON TOP of what the solver
   * is paid — extra debt against unchanged collateral — and on an exit it gives up extra collateral.
   * Leaving it out of the projection therefore understates LTV and overstates the ceiling, which is
   * the Aave `'36'` failure mode this module exists to prevent.
   */
  feeBps?: number;
};

export type LeverageBorrowSizing = {
  /** Borrow-token amount the position should borrow. */
  borrowAmount: bigint;
  /**
   * What the solver receives as the intent's input: the borrowed amount, plus the user's own
   * contribution on a debt-side open, since the debt-side hook is paid both. Quote this.
   */
  intentInput: bigint;
  /** The deposit's value, priced with the token actually deposited. */
  depositUsd: number;
  /** Value being borrowed, EXCLUDING the partner fee. This is what the solver is paid. */
  borrowUsd: number;
  /** Partner fee on this leg, in the borrow token's own units. Zero when none is configured. */
  feeAmount: bigint;
  /** Total the position ends up owing: `borrowUsd` plus the fee's value. */
  debtUsd: number;
};

/**
 * Phase 1: the borrow for a target leverage, and the input to quote.
 *
 * ORACLE SIZING ONLY. It deliberately does not project the result, because at this point it cannot —
 * the collateral that lands is whatever the solver pays. Feed `intentInput` to a solver quote and
 * pass the result to {@link projectLeverageLeg}.
 */
export function sizeLeverageBorrow(request: LeverageLegRequest): LeverageBorrowSizing {
  const { side, deposit, depositDecimals, collateralPriceUsd, borrowPriceUsd, borrowDecimals, leverage } = request;
  const depositTokens = Number(formatUnits(deposit, depositDecimals));
  // Priced with what was actually deposited: using the collateral price on a debt-side open
  // overstated the deposit by the whole sUSDS/USSD spread.
  const depositUsd = depositTokens * (side === 'debt' ? borrowPriceUsd : collateralPriceUsd);

  /**
   * The token conversion runs in bigint; only the RATIO comes from floating point.
   *
   * Going through `Number` and `toFixed(decimals)` instead — the obvious way — turns a clean 2.14
   * into 2140000000000000124 wei: `1.07 x 2` is not exactly representable, and the decimal string
   * carries the error all the way down to sub-wei. Harmless in a display; this number is what gets
   * borrowed.
   *
   * `RATIO_SCALE` is 1e9 and not 1e18 deliberately — a double holds integers exactly only to about
   * 9e15, so scaling by 1e18 would reintroduce the error being avoided. Nine significant digits is
   * already finer than the oracle's own precision.
   *
   * Floored, never rounded up: borrowing a hair more than asked moves LTV the way that reverts.
   */
  const RATIO_SCALE = 1_000_000_000n;
  const ratio =
    borrowPriceUsd > 0 && depositTokens > 0
      ? (depositUsd * Math.max(leverage - 1, 0)) / borrowPriceUsd / depositTokens
      : 0;
  const borrowAmount =
    (deposit * BigInt(Math.floor(ratio * Number(RATIO_SCALE))) * 10n ** BigInt(borrowDecimals)) /
    (RATIO_SCALE * 10n ** BigInt(depositDecimals));

  /**
   * The intent input is denominated in the BORROW RESERVE's units, so a debt-side contribution has
   * to be rescaled before it can be added — `deposit` is in the held token's decimals, which is not
   * the reserve's for anything but an 18-decimal asset.
   *
   * Adding them raw understates the contribution by the decimal gap: a 6-decimal funding token
   * contributed 1e-12 of its value, so `totalInput` collapsed to roughly the borrow alone and the
   * position opened well under the requested leverage against a floor quoted for the wrong size.
   * This is the same translation the asset manager applies to an incoming spoke deposit, and the
   * same one `encodeWrapIntoReserve` uses for the contribution the contract actually receives.
   */
  const depositInBorrowUnits = (deposit * 10n ** BigInt(borrowDecimals)) / 10n ** BigInt(depositDecimals);
  // Mirrors the contract exactly — `LeveragePosition._feeFor` is `(inputAmount * feeBps) / 10_000`
  // over the INTENT INPUT, which on a debt-side open includes the user's own contribution.
  const intentInput = side === 'debt' ? borrowAmount + depositInBorrowUnits : borrowAmount;
  const feeAmount = request.feeBps ? (intentInput * BigInt(Math.round(request.feeBps))) / 10_000n : 0n;
  const borrowUsd = Number(formatUnits(borrowAmount, borrowDecimals)) * borrowPriceUsd;
  const feeUsd = Number(formatUnits(feeAmount, borrowDecimals)) * borrowPriceUsd;

  return {
    borrowAmount,
    intentInput,
    depositUsd,
    // Taken from the amount actually being borrowed, so the projection cannot disagree with the
    // transaction by the rounding above.
    borrowUsd,
    feeAmount,
    // The fee is borrowed on top on a leverage-up, so it is debt even though the solver never sees it.
    debtUsd: borrowUsd + feeUsd,
  };
}

export type LeverageLegQuote = {
  /** What the solver quoted for `intentInput`, in the collateral reserve's decimals. */
  quotedCollateral: bigint;
  collateralDecimals: number;
};

export type ReserveRiskParams = {
  /** Reserve (or eMode) max LTV as a fraction. The Aave `'36'` boundary. */
  ltv: number;
  /** Liquidation threshold as a fraction. */
  liquidationThreshold: number;
};

export type LeverageLegProjection = {
  /** Slippage floor to post as the intent's `minCollateralOut`. Never zero. */
  minCollateralOut: bigint;
  /** Collateral the position holds after the fill, at the floor. */
  collateralUsd: number;
  debtUsd: number;
  ltv: number;
  /** Aave health factor at the floor; `Infinity` with no debt. */
  healthFactor: number;
  /**
   * Whether the pool would reject the borrow outright. This is the Aave `'36'` check, and the one
   * thing a caller must not post through: the intent is accepted and fails at fill.
   */
  exceedsMaxLtv: boolean;
  /**
   * Fraction of the input's oracle value the solver keeps, measured from the QUOTE rather than the
   * floor — the expected cost of the leg, not the worst permitted one. Negative when the quote beats
   * parity, which a correlated pair can do.
   */
  haircut: number;
  /** Oracle value handed to the solver: the borrow, plus the contribution on a debt-side open. */
  inputUsd: number;
  /**
   * What the leg costs once, in the same units as the prices: the solver's cut PLUS the partner fee.
   * Paid up front and in full, unlike the yield it buys, so it is what a payback period is measured
   * against. Can be negative when the quote beats parity and no fee is charged.
   *
   * The fee belongs here even though it is borrowed rather than deducted — the owner owes it without
   * receiving anything for it, so a breakeven that left it out would promise too short a payback.
   */
  costUsd: number;
  /**
   * Collateral over equity — what the open position reports, and what `request.leverage` is not.
   * The two differ by the haircut, this one always larger: 2.00x requested at a 4.657% haircut
   * reports 2.0488x. At the floor like the rest of phase 2, so it is an upper bound.
   */
  exposureLeverage: number;
  /**
   * The most leverage this price actually supports, from `debt <= ltv x collateral` with `f` as the
   * USD of collateral the floor returns per USD handed to the solver:
   *
   *   debt side:       L <= 1 / (1 - ltv x f)          — the deposit buys collateral, none is supplied
   *   collateral side: L <= 1 + ltv / (1 - ltv x f)    — the deposit is also collateral
   *
   * At `f = 1` the second collapses to the familiar `1 / (1 - ltv)`. Below 1 it is strictly lower,
   * which is the whole point: `ltv` 91% with `f` 0.9877 gives 9.88x, and the 11.03x that looked fine
   * against oracle parity was never available. Above `f = 1 / ltv` there is no ceiling at all and
   * this is `Infinity` — a favourable enough fill adds borrowing power faster than debt.
   */
  usableMaxLeverage: number;
};

/**
 * Phase 2: the floor to post, the position that results from it, and the leverage ceiling this quote
 * actually supports.
 *
 * `slippagePct` is a percentage (1 means 1%) and comes off what the solver QUOTED, not off the input
 * amount — sizing the floor as `deposit x leverage x (1 - slippage)` assumes 1:1 token parity and put
 * earlier attempts above what the solver would pay, which made them unfillable.
 */
export function projectLeverageLeg(
  request: LeverageLegRequest,
  quote: LeverageLegQuote,
  risk: ReserveRiskParams,
  slippagePct: number,
): LeverageLegProjection {
  const { side, collateralPriceUsd, leverage } = request;
  const sized = sizeLeverageBorrow(request);
  const { depositUsd, borrowUsd } = sized;

  const floor = (quote.quotedCollateral * BigInt(Math.round((100 - slippagePct) * 100))) / 10_000n;
  const minCollateralOut = floor > 0n ? floor : 1n;

  const floorUsd = Number(formatUnits(minCollateralOut, quote.collateralDecimals)) * collateralPriceUsd;
  const quotedUsd = Number(formatUnits(quote.quotedCollateral, quote.collateralDecimals)) * collateralPriceUsd;
  // On a debt-side open the contribution is handed over too, so the input is the whole `deposit x L`.
  const inputUsd = side === 'debt' ? depositUsd * leverage : borrowUsd;

  const f = inputUsd > 0 ? floorUsd / inputUsd : 0;
  const haircut = inputUsd > 0 ? 1 - quotedUsd / inputUsd : 0;

  const collateralUsd = (side === 'debt' ? 0 : depositUsd) + floorUsd;
  // Fee-inclusive: what the pool will actually see owed, not what the solver was paid.
  const debtUsd = sized.debtUsd;
  const ltv = collateralUsd > 0 ? debtUsd / collateralUsd : 0;

  /**
   * The ceiling, from `debt <= ltv x collateral` with `f` the USD returned per USD handed over and
   * `phi` the fee rate. The fee is borrowed on top, so it enters on the DEBT side:
   *
   *   debt side:       (L-1) + phi.L <= ltv.f.L        =>  L <= 1 / (1 + phi - ltv.f)
   *   collateral side: (L-1)(1+phi)  <= ltv + ltv.f(L-1) => L <= 1 + ltv / (1 + phi - ltv.f)
   *
   * Same denominator either way, and at `phi = 0` both collapse to the fee-free forms. A 50 bp fee
   * is not decorative here: at ltv 91% and f 0.9877 it takes the debt-side ceiling from 9.88x to
   * roughly 9.44x, so a partner charging it and projecting without it hands users an Aave `'36'`.
   *
   * `ltv x f >= 1 + phi` is not a degenerate case, it is the UNBOUNDED one: every extra turn then
   * adds more borrowing power than it adds debt, so no finite ceiling exists. Reporting `1` there —
   * as this did first — inverts the answer at exactly the most favourable prices, discontinuously.
   *
   * `ltv == 0` genuinely is 1: borrowing is disabled, so leverage cannot exceed the deposit.
   */
  const ltvF = risk.ltv * f;
  const phi = (request.feeBps ?? 0) / 10_000;
  const denominator = 1 + phi - ltvF;
  const usableMaxLeverage =
    risk.ltv <= 0
      ? 1
      : denominator <= 0
        ? Number.POSITIVE_INFINITY
        : side === 'debt'
          ? 1 / denominator
          : 1 + risk.ltv / denominator;

  const equityUsd = collateralUsd - debtUsd;

  return {
    minCollateralOut,
    collateralUsd,
    debtUsd,
    exposureLeverage: equityUsd > 0 ? collateralUsd / equityUsd : Number.POSITIVE_INFINITY,
    ltv,
    healthFactor: debtUsd > 0 ? (collateralUsd * risk.liquidationThreshold) / debtUsd : Number.POSITIVE_INFINITY,
    exceedsMaxLtv: ltv > risk.ltv,
    haircut,
    inputUsd,
    costUsd: inputUsd * haircut + sized.debtUsd - borrowUsd,
    usableMaxLeverage,
  };
}
