import { isAuthFailure, type BridgeSubmitTxStatusDataV2 } from '@sodax/sdk';

export const BRIDGE_SUBMIT_TX_STATUS_POLL_MS = 1000;

/** Stops on a terminal status, on `abandonedAt` (even while `status` is non-terminal) or on API-key rejection
 * (`retry` only bounds attempts within a tick). Kept React-free so it is unit-testable under `node`. */
export function getBridgeSubmitTxStatusRefetchInterval(
  error: unknown,
  data: BridgeSubmitTxStatusDataV2 | undefined,
): number | false {
  if (isAuthFailure(error)) return false;
  if (data?.status === 'executed' || data?.status === 'failed' || data?.abandonedAt) return false;
  return BRIDGE_SUBMIT_TX_STATUS_POLL_MS;
}
