/**
 * The result of a position write that posts a solver intent, and the reporting step it depends on.
 *
 * Kept beside the service rather than inside it because the shape is a public contract: every caller
 * — React or not — has to be able to tell "the transaction landed" from "the solver knows about it",
 * and those are not the same event.
 */

import type { Hex, Result, SolverExecutionRequest, SolverExecutionResponse } from '@sodax/types';
import type { TxHashPair } from '../shared/types/types.js';
import type { LeverageYieldPostExecutionError } from './errors.js';

/**
 * What a position write that POSTS AN INTENT returns.
 *
 * `notified` is separate from success on purpose. An intent lives on the hub the moment the call
 * lands, but the solver only learns of it when its hub-side hash is reported — and an unreported one
 * expires unfilled, leaving the owner funded with leverage that never arrives.
 *
 * SO A FAILED NOTIFICATION IS `ok: true`, NOT `ok: false`. The money has already moved and the intent
 * is live; returning a failure would tell the caller nothing happened, and a caller that retries on
 * failure would open a second position. Report it, do not raise it.
 */
export type LeveragePositionIntentResult = {
  /**
   * Both hashes, and they are not interchangeable: `srcChainTxHash` is what the user signed,
   * `dstChainTxHash` is the hub transaction the intent actually exists in.
   */
  txHashes: TxHashPair;
  /** False means the intent is live but nothing will fill it before it expires. */
  notified: boolean;
  /** Why the notification failed, when it did. */
  notifyError?: string;
};

/** The notify half, narrowed so it can be exercised without constructing a whole service. */
export type PositionIntentNotifier = (
  request: SolverExecutionRequest,
) => Promise<Result<SolverExecutionResponse, LeverageYieldPostExecutionError>>;

/**
 * Reports a position intent to the solver and says whether that landed.
 *
 * WHICH HASH: `dstChainTxHash`. On the hub that is the transaction the user signed, but from a spoke
 * the intent is created by the relayed message, so the signed hash is not where it lives.
 */
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
