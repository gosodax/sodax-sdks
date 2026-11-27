import type { Hex, Result, SolverExecutionRequest, SolverExecutionResponse } from '@sodax/types';
import type { TxHashPair } from '../shared/types/types.js';
import type { LeverageYieldPostExecutionError } from './errors.js';

/**
 * A failed solver notification is still `ok: true`: funds moved and the intent is live, so a caller
 * retrying on failure would open a second position. An unreported intent expires unfilled.
 */
export type LeveragePositionIntentResult = {
  /** `srcChainTxHash` is what the user signed; `dstChainTxHash` is the hub tx the intent lives in. */
  txHashes: TxHashPair;
  /** False means the intent is live but nothing will fill it before it expires. */
  notified: boolean;
  notifyError?: string;
};

/** The notify half, narrowed so it can be exercised without constructing a whole service. */
export type PositionIntentNotifier = (
  request: SolverExecutionRequest,
) => Promise<Result<SolverExecutionResponse, LeverageYieldPostExecutionError>>;

/** Reports the intent by `dstChainTxHash`: from a spoke the intent is created by the relayed message, not the signed tx. */
export async function reportPositionIntent(
  notifySolver: PositionIntentNotifier,
  txHashes: TxHashPair,
): Promise<LeveragePositionIntentResult> {
  const result = await notifySolver({ intent_tx_hash: txHashes.dstChainTxHash as Hex }).catch((error: unknown) => ({
    ok: false as const,
    error,
  }));

  if (result.ok) return { txHashes, notified: true };
  const { error } = result;
  return { txHashes, notified: false, notifyError: error instanceof Error ? error.message : String(error) };
}
