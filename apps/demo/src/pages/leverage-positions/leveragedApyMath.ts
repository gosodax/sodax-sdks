/**
 * Presentation around the leveraged-APY math, which lives in `@sodax/sdk` beside `positionSizing` —
 * deciding whether a position is worth opening is not this app's business to define.
 *
 * What stays here is the formatting the SDK has no business owning: a reserve's rate is a decimal
 * fraction on the wire and a percentage on screen, and a duration in years is not something to show
 * a reader as `0.0274`.
 */

export { leveragedNetApyPct, timeToBreakevenYears, type BreakevenInput } from '@sodax/dapp-kit';

/** A reserve's APY as a percentage. The SDK reports these as decimal fractions. */
export function apyPctFromReserve(apy: string | number | undefined): number {
  const n = Number(apy ?? 0);
  return Number.isFinite(n) ? n * 100 : 0;
}

/** Years as something readable — days below a couple of months, then months, then years. */
export function formatDuration(years: number): string {
  const days = years * 365;
  if (days < 1) return `${(days * 24).toFixed(1)} hours`;
  if (days < 60) return `${days.toFixed(1)} days`;
  if (years < 2) return `${(years * 12).toFixed(1)} months`;
  return `${years.toFixed(1)} years`;
}
