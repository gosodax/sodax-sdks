/** The tagged status union behind `LeverageYieldService.getDetailedStatus`. Pure — no I/O. */

import type { Hex, SolverIntentStatusResponse, SpokeChainKey, SubmitTxStatusDataV2 } from '@sodax/types';

/** The identity a detailed status is read for — the backend submit-tx record's key. */
export type DetailedLeverageYieldStatusKey = {
  srcChainKey: SpokeChainKey;
  srcTxHash: string;
};

/**
 * Which of the two existing status sources answered, with that source's payload unmodified.
 * A router, not a merge — see `docs/LEVERAGE_YIELD.md` § Get Detailed Status.
 *
 * The arms are swap's, not bridge's: a vault deposit or withdrawal IS a solver intent, so once the
 * backend record stops answering the solver is who knows what became of it. Bridge's second arm is
 * the relay packet, which is terminal on arrival; here the packet is only the route to `dstTxHash`,
 * the hub tx the solver is keyed on, so it is hoisted rather than returned whole.
 */
export type DetailedLeverageYieldStatus =
  | { source: 'backend'; data: SubmitTxStatusDataV2 }
  | { source: 'solver'; dstTxHash: Hex; data: SolverIntentStatusResponse };
