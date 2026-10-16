import type { SolverExecutionResponse } from '@sodax/types';
import { describe, expect, it, vi } from 'vitest';
import { SodaxError } from '../errors/SodaxError.js';
import type { TxHashPair } from '../shared/types/types.js';
import { reportPositionIntent, type PositionIntentNotifier } from './positionIntent.js';

const HASHES: TxHashPair = {
  srcChainTxHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
  dstChainTxHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
};

const OK: SolverExecutionResponse = {
  answer: 'OK',
  intent_hash: '0x3333333333333333333333333333333333333333333333333333333333333333',
};

const solverError = (message: string) => new SodaxError('EXTERNAL_API_ERROR', message, { feature: 'leverageYield' });

describe('reportPositionIntent', () => {
  it('reports the HUB hash, not the one the user signed', async () => {
    // From a spoke the intent is created by the relayed message, so the signed hash is not where it
    // lives and reporting it tells the solver about a transaction with no intent in it.
    const notifySolver: PositionIntentNotifier = vi.fn(async () => ({ ok: true as const, value: OK }));
    await reportPositionIntent(notifySolver, HASHES);
    expect(notifySolver).toHaveBeenCalledWith({ intent_tx_hash: HASHES.dstChainTxHash });
  });

  it('returns the hashes alongside a successful notification', async () => {
    const notifySolver: PositionIntentNotifier = vi.fn(async () => ({ ok: true as const, value: OK }));
    await expect(reportPositionIntent(notifySolver, HASHES)).resolves.toEqual({
      txHashes: HASHES,
      notified: true,
    });
  });

  it('REPORTS a failed notification instead of throwing, because the intent already exists', async () => {
    // Throwing would read as "the operation failed" while the owner is funded and the intent is live
    // on the hub — it will just expire unfilled, and nothing would have said so.
    const notifySolver: PositionIntentNotifier = vi.fn(async () => ({
      ok: false as const,
      error: solverError('solver unreachable'),
    }));
    await expect(reportPositionIntent(notifySolver, HASHES)).resolves.toEqual({
      txHashes: HASHES,
      notified: false,
      notifyError: 'solver unreachable',
    });
  });

  it('treats a thrown notification the same as a failed Result', async () => {
    const notifySolver: PositionIntentNotifier = vi.fn(async () => {
      throw new Error('network down');
    });
    const result = await reportPositionIntent(notifySolver, HASHES);
    expect(result).toEqual({ txHashes: HASHES, notified: false, notifyError: 'network down' });
  });

  it('stringifies a non-Error rejection rather than losing it', async () => {
    const notifySolver: PositionIntentNotifier = vi.fn(async () => {
      throw 'boom';
    });
    await expect(reportPositionIntent(notifySolver, HASHES)).resolves.toMatchObject({
      notified: false,
      notifyError: 'boom',
    });
  });
});
