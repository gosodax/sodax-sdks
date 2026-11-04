import { isAuthFailure, type BridgeSubmitTxStatusDataV2 } from '@sodax/sdk';

export const BRIDGE_SUBMIT_TX_STATUS_POLL_MS = 1000;

/**
 * Polling interval for {@link useBridgeApiSubmitTxStatus}. Stops on a terminal record, on a record
 * the backend abandoned, and on a terminal API-key rejection.
 *
 * `abandonedAt` is terminal even when `status` is still non-terminal (e.g. `'relayed'`) — same rule
 * as the SDK's `pollBackendSubmitTx`. The auth stop is separate from the hook's `retry` policy:
 * `retry` bounds attempts *within* a tick, so without this the interval would keep firing a request
 * a corrected key is the only fix for.
 *
 * Kept in its own pure module (no React/context imports) so it is unit-testable in dapp-kit's
 * `node` test environment — importing the hook itself pulls in `useSodaxContext`. Same reason as
 * `swapsApi/isTerminalSwapIntentStatus`.
 */
export function getBridgeSubmitTxStatusRefetchInterval(
  error: unknown,
  data: BridgeSubmitTxStatusDataV2 | undefined,
): number | false {
  if (isAuthFailure(error)) return false;
  if (data?.status === 'executed' || data?.status === 'failed' || data?.abandonedAt) return false;
  return BRIDGE_SUBMIT_TX_STATUS_POLL_MS;
}
