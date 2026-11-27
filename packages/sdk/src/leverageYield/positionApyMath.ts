// Rates are percentages, amounts USD, durations years.

/** Net APY on equity at `leverage`, all rates as percentages. */
export function leveragedNetApyPct(supplyApyPct: number, borrowApyPct: number, leverage: number): number {
  return supplyApyPct * leverage - borrowApyPct * (leverage - 1);
}

export type BreakevenInput = {
  /** What the solver is handed less what it pays back. */
  costUsd: number;
  /** `collateral - debt` AFTER the fill, not the deposit (which is larger by the solver's spread). */
  equityUsd: number;
  /** 1 for a fresh open. */
  fromLeverage: number;
};

/**
 * Years until the INCREMENTAL yield `(supply - borrow) x (to - from)` repays the swap cost (entry only;
 * a round trip costs roughly double). `'never'` when supply <= borrow, `'immediate'` when the quote beat parity.
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
