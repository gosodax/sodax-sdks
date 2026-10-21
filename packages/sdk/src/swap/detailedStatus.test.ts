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
  it('flags a terminal failure and a record abandoned mid-flight', () => {
    expect(isBackendSubmitTxAbandoned({ ...baseRecord, status: 'failed' })).toBe(true);
    expect(isBackendSubmitTxAbandoned({ ...baseRecord, abandonedAt: '2026-08-14T00:00:00.000Z' })).toBe(true);
  });

  it('leaves an in-flight record alone', () => {
    expect(isBackendSubmitTxAbandoned(baseRecord)).toBe(false);
    expect(isBackendSubmitTxAbandoned({ ...baseRecord, status: 'solved' })).toBe(false);
    // Matches `pollBackendSubmitTx`, which treats an empty timestamp as falsy.
    expect(isBackendSubmitTxAbandoned({ ...baseRecord, abandonedAt: '' })).toBe(false);
  });
});

describe('summarizeSwapStatus', () => {
  const HUB = '0x1111111111111111111111111111111111111111111111111111111111111111';
  const FILL = '0x2222222222222222222222222222222222222222222222222222222222222222';

  it.each([
    ['pending', 'pending'],
    ['relaying', 'pending'],
    ['relayed', 'pending'],
    ['posting_execution', 'pending'],
    ['posted_execution', 'pending'],
    ['solved', 'solved'],
    ['failed', 'failed'],
  ] as const)('maps the backend %s status to %s', (status, state) => {
    expect(summarizeSwapStatus({ source: 'backend', data: { ...baseRecord, status } }).state).toBe(state);
  });

  it('reads the backend hub and fill hashes from the result', () => {
    const summary = summarizeSwapStatus({
      source: 'backend',
      data: { ...baseRecord, status: 'solved', result: { dstIntentTxHash: HUB, fillTxHash: FILL } },
    });
    expect(summary).toEqual({ state: 'solved', hubTxHash: HUB, fillTxHash: FILL });
  });

  it('leaves a backend fill hash out when the journal confirmed the fill without one', () => {
    const summary = summarizeSwapStatus({
      source: 'backend',
      data: { ...baseRecord, status: 'solved', result: { dstIntentTxHash: HUB } },
    });
    expect(summary).toEqual({ state: 'solved', hubTxHash: HUB, fillTxHash: undefined });
  });

  it.each([
    [SolverIntentStatusCode.NOT_FOUND, 'pending'],
    [SolverIntentStatusCode.NOT_STARTED_YET, 'pending'],
    [SolverIntentStatusCode.STARTED_NOT_FINISHED, 'pending'],
    [SolverIntentStatusCode.SOLVED, 'solved'],
    [SolverIntentStatusCode.FAILED, 'failed'],
  ] as const)('maps the solver status %s to %s', (status, state) => {
    expect(summarizeSwapStatus({ source: 'solver', dstTxHash: HUB, data: { status } }).state).toBe(state);
  });

  it('reads the solver hub hash from the arm and the fill hash from the payload', () => {
    const summary = summarizeSwapStatus({
      source: 'solver',
      dstTxHash: HUB,
      data: { status: SolverIntentStatusCode.SOLVED, fill_tx_hash: FILL },
    });
    expect(summary).toEqual({ state: 'solved', hubTxHash: HUB, fillTxHash: FILL });
  });

  it('drops a fill hash that is not hex', () => {
    const summary = summarizeSwapStatus({
      source: 'solver',
      dstTxHash: HUB,
      data: { status: SolverIntentStatusCode.SOLVED, fill_tx_hash: 'not-a-hash' },
    });
    expect(summary.fillTxHash).toBeUndefined();
  });

  it('accepts a DetailedLeverageYieldStatus, which docs/LEVERAGE_YIELD.md relies on', () => {
    const status: DetailedLeverageYieldStatus = {
      source: 'solver',
      dstTxHash: HUB,
      data: { status: SolverIntentStatusCode.SOLVED, fill_tx_hash: FILL },
    };
    expect(summarizeSwapStatus(status)).toEqual({ state: 'solved', hubTxHash: HUB, fillTxHash: FILL });
  });
});
