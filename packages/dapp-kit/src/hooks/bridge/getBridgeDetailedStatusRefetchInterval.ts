import {
  DETAILED_STATUS_NOT_DELIVERED,
  isAuthFailure,
  type BridgeDetailedStatusError,
  type DetailedBridgeStatus,
  type Result,
} from '@sodax/sdk';
import { MAX_NOT_FOUND_POLLS, STATUS_POLL_MS } from '../shared/notFoundStreak.js';

/**
 * Structural mirror of `useBridgeDetailedStatus`'s data type. Declared locally rather than imported
 * so this module does not own the hook's public contract.
 */
type DetailedBridgeStatusRead = Result<DetailedBridgeStatus, BridgeDetailedStatusError> | undefined;

/**
 * The read the budget counts: the relay has no packet for this source tx *and* the backend answered,
 * so the miss is real rather than unprovable. Every other `LOOKUP_FAILED` is a dependency failing
 * right now — the relay unreachable, a malformed response — and those keep polling, because that is
 * how the read recovers when the outage ends.
 */
export function isBridgeNotDelivered(data: DetailedBridgeStatusRead): boolean {
  return data !== undefined && !data.ok && data.error?.context?.reason === DETAILED_STATUS_NOT_DELIVERED;
}

/**
 * Polling interval for `useBridgeDetailedStatus`.
 *
 * Unlike the swap analog there is no in-flight second arm to wait on: the relay arm only ever
 * carries a matched `executed` packet, so it is terminal on arrival. That leaves three stops — a
 * terminal or abandoned backend record, a rejected API key, and the ambiguous relay miss once it has
 * run `MAX_NOT_FOUND_POLLS` times in a row.
 *
 * Kept in its own pure module (no React/context imports) so it is unit-testable in dapp-kit's `node`
 * test environment — importing the hook itself pulls in `useSodaxContext`.
 */
export function getBridgeDetailedStatusRefetchInterval(
  data: DetailedBridgeStatusRead,
  consecutiveNotFound: number,
): number | false {
  if (data?.ok) {
    if (data.value.source === 'relay') return false;
    // The two terminal states of the bridge wire contract, plus a record the backend abandoned
    // while its status was still non-terminal.
    const { status, abandonedAt } = data.value.data;
    return status === 'executed' || status === 'failed' || abandonedAt ? false : STATUS_POLL_MS;
  }
  // A rejected key is terminal — only a corrected key changes the answer, so stop asking.
  if (data && !data.ok && isAuthFailure(data.error)) return false;
  if (isBridgeNotDelivered(data) && consecutiveNotFound >= MAX_NOT_FOUND_POLLS) return false;
  return STATUS_POLL_MS;
}
