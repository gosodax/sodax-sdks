// LeverageHook borrows against what the solver actually paid, so oracle-only sizing reverts with Aave '36' at fill.
// Prices: pool oracle base currency (only ratios matter); rates and LTVs are fractions, not percentages.

import { formatUnits } from 'viem';

export type PositionSide = 'collateral' | 'debt';

export type LeverageLegRequest = {
  /** `'debt'` deposits are NOT supplied, only handed to the solver; never count them as collateral too. */
  side: PositionSide;
  /** In the collateral or debt token's own decimals, per `side`. */
  deposit: bigint;
  depositDecimals: number;
  collateralPriceUsd: number;
  borrowPriceUsd: number;
  borrowDecimals: number;
  /** Multiple of the DEPOSIT, not equity; the open position reports more (see `exposureLeverage`). */
  leverage: number;
  /** `PositionConfig.feeBps`. Borrowed ON TOP of the solver input (extra debt), not cut from the output. */
  feeBps?: number;
};

export type LeverageBorrowSizing = {
  borrowAmount: bigint;
  /** Solver input: the borrow, plus the user's contribution on a debt-side open. Quote this. */
  intentInput: bigint;
  depositUsd: number;
  /** Excludes the partner fee; what the solver is paid. */
  borrowUsd: number;
  /** In the borrow token's own units. */
  feeAmount: bigint;
  /** `borrowUsd` plus the fee's value. */
  debtUsd: number;
};

/** Phase 1: oracle-priced borrow for a target leverage. Quote `intentInput`, then call {@link projectLeverageLeg}. */
export function sizeLeverageBorrow(request: LeverageLegRequest): LeverageBorrowSizing {
  const { side, deposit, depositDecimals, collateralPriceUsd, borrowPriceUsd, borrowDecimals, leverage } = request;
  const depositTokens = Number(formatUnits(deposit, depositDecimals));
  // Priced with what was actually deposited; the collateral price would overstate a debt-side deposit.
  const depositUsd = depositTokens * (side === 'debt' ? borrowPriceUsd : collateralPriceUsd);

  // Bigint conversion avoids float-to-wei error; RATIO_SCALE is 1e9 since doubles are exact only to ~9e15.
  // Floored, never rounded up: borrowing a hair more moves LTV toward a revert.
  const RATIO_SCALE = 1_000_000_000n;
  const ratio =
    borrowPriceUsd > 0 && depositTokens > 0
      ? (depositUsd * Math.max(leverage - 1, 0)) / borrowPriceUsd / depositTokens
      : 0;
  const borrowAmount =
    (deposit * BigInt(Math.floor(ratio * Number(RATIO_SCALE))) * 10n ** BigInt(borrowDecimals)) /
    (RATIO_SCALE * 10n ** BigInt(depositDecimals));

  // Intent input is in the BORROW RESERVE's decimals, so the debt-side contribution must be rescaled first.
  const depositInBorrowUnits = (deposit * 10n ** BigInt(borrowDecimals)) / 10n ** BigInt(depositDecimals);
  // Mirrors `LeveragePosition._feeFor`: `(inputAmount * feeBps) / 10_000` over the intent input.
  const intentInput = side === 'debt' ? borrowAmount + depositInBorrowUnits : borrowAmount;
  const feeAmount = request.feeBps ? (intentInput * BigInt(Math.round(request.feeBps))) / 10_000n : 0n;
  const borrowUsd = Number(formatUnits(borrowAmount, borrowDecimals)) * borrowPriceUsd;
  const feeUsd = Number(formatUnits(feeAmount, borrowDecimals)) * borrowPriceUsd;

  return {
    borrowAmount,
    intentInput,
    depositUsd,
    // From the amount actually borrowed, so the projection cannot disagree with the tx by rounding.
    borrowUsd,
    feeAmount,
    // The fee is borrowed on top on a leverage-up, so it is debt even though the solver never sees it.
    debtUsd: borrowUsd + feeUsd,
  };
}

export type LeverageLegQuote = {
  /** In the collateral reserve's decimals. */
  quotedCollateral: bigint;
  collateralDecimals: number;
};

export type ReserveRiskParams = {
  /** Max LTV (reserve or eMode) as a fraction; the Aave `'36'` boundary. */
  ltv: number;
  liquidationThreshold: number;
};

export type LeverageLegProjection = {
  /** Post as the intent's `minCollateralOut`. Never zero. */
  minCollateralOut: bigint;
  /** At the floor. */
  collateralUsd: number;
  debtUsd: number;
  ltv: number;
  /** Aave health factor at the floor; `Infinity` with no debt. */
  healthFactor: number;
  /** Aave `'36'`: the intent would be accepted but fail at fill. Never post through it. */
  exceedsMaxLtv: boolean;
  /** Fraction of input oracle value the solver keeps, from the QUOTE (not floor). Negative when it beats parity. */
  haircut: number;
  /** Borrow plus the contribution on a debt-side open. */
  inputUsd: number;
  /** One-time cost: the solver's cut PLUS the partner fee (owed without receiving anything). */
  costUsd: number;
  /** Collateral over equity, at the floor; always larger than `request.leverage` by the haircut. */
  exposureLeverage: number;
  /** Max leverage this quote supports, from `debt <= ltv x collateral`; `Infinity` when `ltv x f >= 1 + fee`. */
  usableMaxLeverage: number;
};

/**
 * Phase 2: floor, resulting position and leverage ceiling, all projected from the FLOOR (worst permitted fill).
 * `slippagePct` is a percentage applied to the QUOTED amount, not the input.
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
  const inputUsd = side === 'debt' ? depositUsd * leverage : borrowUsd;

  const f = inputUsd > 0 ? floorUsd / inputUsd : 0;
  const haircut = inputUsd > 0 ? 1 - quotedUsd / inputUsd : 0;

  const collateralUsd = (side === 'debt' ? 0 : depositUsd) + floorUsd;
  // Fee-inclusive: what the pool will see owed, not what the solver was paid.
  const debtUsd = sized.debtUsd;
  const ltv = collateralUsd > 0 ? debtUsd / collateralUsd : 0;

  // Fee is borrowed on top, so it enters the debt side: debt L <= 1/(1+phi-ltv.f), collateral L <= 1+ltv/(1+phi-ltv.f).
  // A non-positive denominator is unbounded (Infinity); ltv == 0 means borrowing is disabled, so 1.
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
