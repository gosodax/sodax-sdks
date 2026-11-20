/** Compile-time contract for `summarizeSwapStatus`: either status source collapses to one summary type. */
import { describe, expectTypeOf, it } from 'vitest';
import type { DetailedSwapStatus, Hex, SwapStatusSummary } from '../index.js';
import { summarizeSwapStatus } from './detailedStatus.js';

declare const backend: Extract<DetailedSwapStatus, { source: 'backend' }>;
declare const solver: Extract<DetailedSwapStatus, { source: 'solver' }>;

describe('summarizeSwapStatus', () => {
  it('returns the summary, whichever source answered', () => {
    expectTypeOf(summarizeSwapStatus).returns.toEqualTypeOf<SwapStatusSummary>();
    const calls = () => [summarizeSwapStatus(backend), summarizeSwapStatus(solver)] as const;
    expectTypeOf<ReturnType<typeof calls>>().toEqualTypeOf<readonly [SwapStatusSummary, SwapStatusSummary]>();
  });

  it('the summary vocabulary is closed', () => {
    expectTypeOf<SwapStatusSummary>().toEqualTypeOf<{
      state: 'pending' | 'solved' | 'failed';
      hubTxHash?: Hex;
      fillTxHash?: Hex;
    }>();
  });
});
