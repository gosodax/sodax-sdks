import type { Hex, SolverIntentStatusResponse, SpokeChainKey, SubmitTxStatusDataV2 } from '@sodax/types';

/** The backend submit-tx record's key. */
export type DetailedLeverageYieldStatusKey = {
  srcChainKey: SpokeChainKey;
  srcTxHash: string;
};

/**
 * Which status source answered, payload unmodified. Once the backend stops answering the solver is the
 * source, keyed on `dstTxHash` (the hub tx), so the relay packet is hoisted to that rather than returned.
 */
export type DetailedLeverageYieldStatus =
  | { source: 'backend'; data: SubmitTxStatusDataV2 }
  | { source: 'solver'; dstTxHash: Hex; data: SolverIntentStatusResponse };
