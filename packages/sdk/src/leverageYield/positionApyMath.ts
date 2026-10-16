/**
 * Whether a leveraged position is worth opening at all, and how long it must be held to pay for
 * itself.
 *
 * The sibling of `positionSizing.ts`, and here for the same reason: `sizeLeverageBorrow` answers how
 * to open a position, this answers whether to. Both are pure, and a partner integrating without the
 * reference UI needs both — getting this one wrong does not revert, it just quietly sells a position
 * that never earns its entry cost back.
 *
 * Rates are percentages throughout, amounts are USD, and durations are years.
 */

/** Net APY on equity at `leverage`, all rates as percentages. */
export function leveragedNetApyPct(supplyApyPct: number, borrowApyPct: number, leverage: number): number {
  return supplyApyPct * leverage - borrowApyPct * (leverage - 1);
}

/** What the swap costs relative to oracle parity, and the yield that has to earn it back. */
export type BreakevenInput = {
  /** One-time cost of the leg: what the solver is handed, less what it pays back, in USD. */
  costUsd: number;
  /**
   * Equity the incremental yield accrues on, in USD — `collateral - debt` AFTER the fill, not the
   * deposit. They differ by the solver's spread, and the deposit is the larger, so passing it makes
   * every payback look shorter than it is.
   */
  equityUsd: number;
  /** Leverage being moved FROM — 1 for a fresh open, since the alternative is just holding. */
  fromLeverage: number;
};

/**
 * Years until the extra yield from levering up repays what the swap cost, or a reason it never does.
 *
 * Levering is a trade: the solver's cut is paid ONCE, up front and in full, while the benefit arrives
 * as a rate. So the question a target leverage actually poses is how long the position must be held
 * for the second to cover the first:
 *
 *   costUsd = equityUsd x (net(to) - net(from)) x years
 *
 * and `net(to) - net(from)` reduces to `(supply - borrow) x (to - from)` — the incremental term, NOT
 * the headline net APY. Using the headline number would flatter every case: an already-levered
 * position earns most of that rate whether or not you adjust it, so charging the entry cost against
 * the whole thing understates the payback period.
 *
 * Two regimes return no number rather than a misleading one. When supply does not exceed borrow the
 * incremental rate is zero or negative and no holding period repays the cost — levering up is simply
 * a worse position, which is the same fact the zero-crossing row reports. And a non-positive cost
 * means the quote beat parity, so there is nothing to earn back.
 *
 * COUNTS THE ENTRY ONLY. Unwinding sells collateral back through the solver and pays a comparable
 * spread a second time, so a full round trip needs roughly double this to come out even. Treat the
 * number as the floor on how long the position has to be worth holding, not the whole bill.
 */
export function timeToBreakevenYears(
  supplyApyPct: number,
  borrowApyPct: number,
  toLeverage: number,
  { costUsd, equityUsd, fromLeverage }: BreakevenInput,
): number | 'never' | 'immediate' | undefined {
  if (!(equityUsd > 0) || !Number.isFinite(costUsd)) return undefined;
  if (costUsd <= 0) return 'immediate';
  const incrementalPct =
    leveragedNetApyPct(supplyApyPct, borrowApyPct, toLeverage) -
    leveragedNetApyPct(supplyApyPct, borrowApyPct, fromLeverage);
  if (!(incrementalPct > 0)) return 'never';
  return costUsd / (equityUsd * (incrementalPct / 100));
}
