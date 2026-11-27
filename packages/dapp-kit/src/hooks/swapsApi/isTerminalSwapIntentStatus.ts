import type { SwapIntentStatusCodeV2 } from '@sodax/sdk';

/** SOLVED (3) / FAILED (4): polling stops. Kept React-free so it unit-tests in the `node` env. */
export const isTerminalSwapIntentStatus = (status: SwapIntentStatusCodeV2 | undefined): boolean =>
  status === 3 || status === 4;
