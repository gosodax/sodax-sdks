/** The tagged status union behind `SwapService.getDetailedStatus`. Pure — no I/O. */

import {
  type Hex,
  SolverIntentStatusCode,
  type SolverIntentStatusResponse,
  type SpokeChainKey,
  type SubmitTxStatusDataV2,
} from '@sodax/types';
import { isHex } from 'viem';

/** The identity a detailed status is read for — the backend submit-tx record's key. */
export type DetailedSwapStatusKey = {
  srcChainKey: SpokeChainKey;
  srcTxHash: string;
};

/**
 * Which of the two existing status sources answered, with that source's payload unmodified.
 * A router, not a merge — see `docs/SWAPS.md` § Get Detailed Status.
 */
export type DetailedSwapStatus =
  | { source: 'backend'; data: SubmitTxStatusDataV2 }
  | { source: 'solver'; dstTxHash: Hex; data: SolverIntentStatusResponse };

/**
 * A {@link DetailedSwapStatus} collapsed to one vocabulary, whichever source answered. `hubTxHash` is
 * the hub intent tx; `fillTxHash` may be absent even when solved (the backend can confirm a fill
 * from the on-chain journal without one).
 */
export type SwapStatusSummary = {
  state: 'pending' | 'solved' | 'failed';
  hubTxHash?: Hex;
  fillTxHash?: Hex;
};

/** Collapses a {@link DetailedSwapStatus} so callers need not switch on `source`. Pure. */
export function summarizeSwapStatus(status: DetailedSwapStatus): SwapStatusSummary {
  if (status.source === 'backend') {
    const { status: backendStatus, result } = status.data;
    return {
      state: backendStatus === 'solved' || backendStatus === 'failed' ? backendStatus : 'pending',
      hubTxHash: asHex(result?.dstIntentTxHash),
      fillTxHash: asHex(result?.fillTxHash),
    };
  }
  const { status: solverStatus, fill_tx_hash } = status.data;
  return {
    state:
      solverStatus === SolverIntentStatusCode.SOLVED
        ? 'solved'
        : solverStatus === SolverIntentStatusCode.FAILED
          ? 'failed'
          : 'pending',
    hubTxHash: status.dstTxHash,
    fillTxHash: asHex(fill_tx_hash),
  };
}

function asHex(value: string | null | undefined): Hex | undefined {
  return value && isHex(value) ? value : undefined;
}

// The budget vocabulary and the abandonment predicate are shared with the other features that have
// a backend submit-tx record, so they live in `backendApi/detailedStatusRouting.ts`. Re-exported
// here so `./index.js` keeps publishing the same name from the same place.
export { DETAILED_STATUS_NOT_DELIVERED, isBackendSubmitTxAbandoned } from '../backendApi/detailedStatusRouting.js';
