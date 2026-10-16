import { describe, expect, it } from 'vitest';
import { ChainKeys } from '@sodax/types';
import { DETAILED_STATUS_NOT_DELIVERED, isSodaxError, Sodax } from '../index.js';

/**
 * E2e contract pin for `SwapService.getDetailedStatus`, against live APIs.
 *
 * `getDetailedStatus` degrades to the relay + solver whenever the backend has no submit-tx record,
 * and it identifies that case by the backend answering **404**. That is a backend behaviour the SDK
 * depends on and does not control, so it is asserted here directly: if the backend ever starts
 * synthesizing a record for an unknown key instead, the degrade path would silently stop firing and
 * every fallback-completed swap would report a fabricated status. The unit tests cannot catch that —
 * they mock the 404.
 *
 * A tx hash that has never existed, so no record can ever be created for it.
 */
const UNKNOWN_TX_HASH = '0x0000000000000000000000000000000000000000000000000000000000000001';

describe('SwapService.getDetailedStatus (e2e, live backend + relay + solver)', () => {
  const sodax = new Sodax();
  const key = { srcChainKey: ChainKeys.ARBITRUM_MAINNET, srcTxHash: UNKNOWN_TX_HASH } as const;

  it('answers 404 for a submit-tx record that does not exist', async () => {
    const record = await sodax.api.swaps.getSubmitTxStatus({
      txHash: key.srcTxHash,
      srcChainKey: key.srcChainKey,
    });

    expect(record.ok).toBe(false);
    expect(!record.ok && isSodaxError(record.error) && record.error.context?.status).toBe(404);
  });

  // With no record and no relay packet there is no hub tx hash, so there is nothing for the solver
  // to answer about — a miss, not a lifecycle step.
  //
  // The `reason` assertion is the point of this test, not a detail: the relayer answers 404 (not an
  // empty packet list) for a tx it has not indexed, and only a 404 tagged
  // `DETAILED_STATUS_NOT_DELIVERED` lets `useDetailedStatus` spend its budget and stop. If the
  // relayer ever switched to a 200 with an empty list, or to a different status, this fails loudly
  // instead of silently reverting an unrelayable swap to polling forever.
  it('fails with a budgetable LOOKUP_FAILED when no source can answer for the tx', async () => {
    const result = await sodax.swaps.getDetailedStatus(key);

    expect(result.ok).toBe(false);
    expect(!result.ok && isSodaxError(result.error) && result.error.code).toBe('LOOKUP_FAILED');
    expect(!result.ok && isSodaxError(result.error) && result.error.context?.reason).toBe(
      DETAILED_STATUS_NOT_DELIVERED,
    );
  });
});
