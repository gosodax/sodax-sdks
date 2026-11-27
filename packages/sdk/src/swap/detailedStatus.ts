import {
  type Hex,
  SolverIntentStatusCode,
  type SolverIntentStatusResponse,
  type SpokeChainKey,
  type SubmitTxStatusDataV2,
} from '@sodax/types';
import { isHex } from 'viem';

export type DetailedSwapStatusKey = {
  srcChainKey: SpokeChainKey;
  srcTxHash: string;
};

/** Whichever source answered, payload unmodified (a router, not a merge). */
export type DetailedSwapStatus =
  | { source: 'backend'; data: SubmitTxStatusDataV2 }
  | { source: 'solver'; dstTxHash: Hex; data: SolverIntentStatusResponse };

/** `fillTxHash` may be absent even when solved: the backend can confirm a fill from the journal without one. */
export type SwapStatusSummary = {
  state: 'pending' | 'solved' | 'failed';
  hubTxHash?: Hex;
  fillTxHash?: Hex;
};

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

export { DETAILED_STATUS_NOT_DELIVERED, isBackendSubmitTxAbandoned } from '../backendApi/detailedStatusRouting.js';
