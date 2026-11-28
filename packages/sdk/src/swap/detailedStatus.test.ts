import { describe, expect, it } from 'vitest';
import { SolverIntentStatusCode, type SubmitTxStatusDataV2 } from '@sodax/types';
import type { DetailedLeverageYieldStatus } from '../leverageYield/detailedStatus.js';
import { isBackendSubmitTxAbandoned, summarizeSwapStatus } from './detailedStatus.js';

const baseRecord: SubmitTxStatusDataV2 = {
  txHash: '0xsrc',
  srcChainKey: 'arb',
  status: 'relaying',
  processingAttempts: 1,
};

describe('isBackendSubmitTxAbandoned', () => {
  it('flags a terminal failure and a record abandoned mid-flight, and leaves an in-flight record alone', () => {
    expect(isBackendSubmitTxAbandoned({ ...baseRecord, status: 'failed' })).toBe(true);
    expect(isBackendSubmitTxAbandoned({ ...baseRecord, abandonedAt: '2026-08-14T00:00:00.000Z' })).toBe(true);
    expect(isBackendSubmitTxAbandoned(baseRecord)).toBe(false);
    expect(isBackendSubmitTxAbandoned({ ...baseRecord, status: 'solved' })).toBe(false);
    // Matches `pollBackendSubmitTx`, which treats an empty timestamp as falsy.
    expect(isBackendSubmitTxAbandoned({ ...baseRecord, abandonedAt: '' })).toBe(false);
  });
});

describe('summarizeSwapStatus', () => {
  const HUB = '0x1111111111111111111111111111111111111111111111111111111111111111';
  const FILL = '0x2222222222222222222222222222222222222222222222222222222222222222';

  // Every non-terminal backend status (pending, relaying, relayed, posting_execution, …) takes the same branch.
  // `solved` is asserted with its hashes below.
  it('maps a non-terminal backend status to pending and a failed one to failed', () => {
    for (const [status, state] of [
      ['posted_execution', 'pending'],
      ['failed', 'failed'],
    ] as const) {
      expect(summarizeSwapStatus({ source: 'backend', data: { ...baseRecord, status } }).state, status).toBe(state);
    }
  });

  it('reads the backend hub and fill hashes from the result, leaving out a fill hash the journal confirmed without', () => {
    const withFill = summarizeSwapStatus({
      source: 'backend',
      data: { ...baseRecord, status: 'solved', result: { dstIntentTxHash: HUB, fillTxHash: FILL } },
    });
    expect(withFill).toEqual({ state: 'solved', hubTxHash: HUB, fillTxHash: FILL });

    const withoutFill = summarizeSwapStatus({
      source: 'backend',
      data: { ...baseRecord, status: 'solved', result: { dstIntentTxHash: HUB } },
    });
    expect(withoutFill).toEqual({ state: 'solved', hubTxHash: HUB, fillTxHash: undefined });
  });

  // NOT_FOUND, NOT_STARTED_YET and STARTED_NOT_FINISHED all take the pending branch.
  it('maps an unfinished solver status to pending and a failed one to failed', () => {
    for (const [status, state] of [
      [SolverIntentStatusCode.STARTED_NOT_FINISHED, 'pending'],
      [SolverIntentStatusCode.FAILED, 'failed'],
    ] as const) {
      expect(summarizeSwapStatus({ source: 'solver', dstTxHash: HUB, data: { status } }).state, `${status}`).toBe(
        state,
      );
    }
  });

  it('reads the solver hub hash from the arm and the fill hash from the payload, accepting a DetailedLeverageYieldStatus', () => {
    // docs/LEVERAGE_YIELD.md relies on summarizeSwapStatus accepting the leverage-yield status type.
    const status: DetailedLeverageYieldStatus = {
      source: 'solver',
      dstTxHash: HUB,
      data: { status: SolverIntentStatusCode.SOLVED, fill_tx_hash: FILL },
    };
    expect(summarizeSwapStatus(status)).toEqual({ state: 'solved', hubTxHash: HUB, fillTxHash: FILL });
  });

  it('drops a fill hash that is not hex', () => {
    const summary = summarizeSwapStatus({
      source: 'solver',
      dstTxHash: HUB,
      data: { status: SolverIntentStatusCode.SOLVED, fill_tx_hash: 'not-a-hash' },
    });
    expect(summary.fillTxHash).toBeUndefined();
  });
});
