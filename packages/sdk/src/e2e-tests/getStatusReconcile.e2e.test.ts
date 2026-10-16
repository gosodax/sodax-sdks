import { describe, expect, it } from 'vitest';
import { SolverIntentStatusCode } from '@sodax/types';
import { Sodax, SolverApiService } from '../index.js';

/**
 * E2e test for the backend fallback in `SwapService.getStatus`, against live APIs.
 *
 * This intent was filled, but the solver has since restarted and lost it, so `/status` answers
 * `NOT_FOUND (-1)`. The first assertion pins that premise — if the solver ever remembers this intent
 * again the test fails loudly rather than passing for the wrong reason — and the second asserts the
 * backend record supplies the fill tx hash.
 */
const INTENT_TX_HASH = '0x242094c15594a9b9c443adfa390b57a99a587b19d57db9b74abb69e2e84a0ef0';
const EXPECTED_FILL_TX_HASH = '0xfe2839879f18d3ededb1e5f9a60f267c1a6ed81a388ab47d4f97179e529c489b';

describe('SwapService.getStatus (e2e, live solver + backend)', () => {
  const sodax = new Sodax();

  it('recovers SOLVED and the fill tx hash for an intent the solver has forgotten', async () => {
    const raw = await SolverApiService.getStatus({ intent_tx_hash: INTENT_TX_HASH }, sodax.swaps.solver);
    expect(raw.ok && raw.value.status).toBe(SolverIntentStatusCode.NOT_FOUND);

    const result = await sodax.swaps.getStatus({ intent_tx_hash: INTENT_TX_HASH });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe(SolverIntentStatusCode.SOLVED);
      expect(result.value.fill_tx_hash).toBe(EXPECTED_FILL_TX_HASH);
    }
  });
});
