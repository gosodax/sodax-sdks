// Quote HUB reserves (e.g. sodaETH/sodaS), not spoke originals, and without a partner fee: the position
// fee is charged on-chain from `PositionConfig.feeBps`, so quoting net of it would count it twice.

import type { SolverErrorResponse } from '@sodax/types';

/** In output-token units. */
export type PositionLegQuote = {
  quotedAmount: bigint;
};

/**
 * True for a "no path" refusal (code `-1`, matched on wording), which the solver also returns for a leg too SMALL;
 * disambiguate by re-quoting at a healthy notional, only when the failed amount was below the probe.
 */
export function isNoRouteRefusal(error: unknown): boolean {
  const message =
    typeof error === 'object' && error !== null && 'detail' in error
      ? (error as SolverErrorResponse).detail?.message
      : error instanceof Error
        ? error.message
        : undefined;
  return /no path was found/i.test(message ?? '');
}
