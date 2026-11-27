import {
  DETAILED_STATUS_NOT_DELIVERED,
  isAuthFailure,
  type BridgeDetailedStatusError,
  type DetailedBridgeStatus,
  type Result,
} from '@sodax/sdk';
import { MAX_MPC_RELAY_NOT_FOUND_POLLS, MAX_NOT_FOUND_POLLS, STATUS_POLL_MS } from '../shared/notFoundStreak.js';

/** Mirrors `useBridgeDetailedStatus`'s data type locally so this module does not own the hook's contract. */
type DetailedBridgeStatusRead = Result<DetailedBridgeStatus, BridgeDetailedStatusError> | undefined;

/**
 * The only read the budget counts: no relay packet *and* the backend answered, so the miss is real.
 * Other `LOOKUP_FAILED`s are outages and keep polling so the read recovers.
 */
export function isBridgeNotDelivered(data: DetailedBridgeStatusRead): boolean {
  return data !== undefined && !data.ok && data.error?.context?.reason === DETAILED_STATUS_NOT_DELIVERED;
}

/** A read the SDK tags `context.mpcRelay`: a bridge with an MPC-relay end, which gets the longer budget. */
export function isBridgeMpcRelayRead(data: DetailedBridgeStatusRead): boolean {
  return data !== undefined && !data.ok && data.error?.context?.mpcRelay === true;
}

/**
 * Relay and MPC-relay answers are terminal on arrival; stops on a terminal/abandoned backend record, a rejected key, or an exhausted miss budget.
 * Kept free of React imports so it is unit-testable in the `node` test environment.
 */
export function getBridgeDetailedStatusRefetchInterval(
  data: DetailedBridgeStatusRead,
  consecutiveNotFound: number,
): number | false {
  if (data?.ok) {
    if (data.value.source !== 'backend') return false;
    // `abandonedAt` marks a record the backend gave up on while still non-terminal.
    const { status, abandonedAt } = data.value.data;
    return status === 'executed' || status === 'failed' || abandonedAt ? false : STATUS_POLL_MS;
  }
  if (data && !data.ok) {
    // Only a corrected key changes the answer, so stop asking.
    if (isAuthFailure(data.error)) return false;
    const budget = isBridgeMpcRelayRead(data) ? MAX_MPC_RELAY_NOT_FOUND_POLLS : MAX_NOT_FOUND_POLLS;
    if (isBridgeNotDelivered(data) && consecutiveNotFound >= budget) return false;
  }
  return STATUS_POLL_MS;
}
