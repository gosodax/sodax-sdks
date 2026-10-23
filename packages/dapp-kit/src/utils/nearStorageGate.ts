import { ChainKeys, type SpokeChainKey } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';

/** The subset of a `useNearStorageCheck` result the gate reads. A full `UseQueryResult<boolean>` satisfies it. */
export type NearStorageCheckResult = Pick<UseQueryResult<boolean>, 'isLoading' | 'data'>;

/** UI gate state for NEP-141 storage registration on NEAR. */
export interface NearStorageGateState {
  /** Destination is NEAR — the only chain with a NEP-141 storage-registration prerequisite. */
  isNear: boolean;
  /** Show the "register storage" action: the check resolved and the recipient is not registered. */
  needsRegistration: boolean;
  /**
   * Keep the downstream action (swap/bridge/borrow/withdraw) disabled: the NEAR gate is unresolved
   * (still checking) or unmet (needs registration).
   */
  blocksAction: boolean;
}

/**
 * Derives the NEP-141 storage-registration UI gate state for a flow that delivers a token to a user
 * on NEAR — NEAR's analogue of the Stellar trustline gate. Unwrapped (no hook): pass the destination
 * `chainKey` and the `useNearStorageCheck` result; the util owns the `=== NEAR` test and reads
 * `isLoading` (NOT `isPending`, which stays `true` for a disabled query and would block forever).
 *
 * `blocksAction` deliberately also covers the in-flight check window so the action can't be
 * triggered before registration status is known; `needsRegistration` only flips once the check has
 * resolved (so the "register" button isn't shown speculatively while still checking).
 */
export function resolveNearStorageGate(
  chainKey: SpokeChainKey | undefined,
  check: NearStorageCheckResult,
): NearStorageGateState {
  const isNear = chainKey === ChainKeys.NEAR_MAINNET;
  const isChecking = check.isLoading;
  const isRegistered = check.data;
  return {
    isNear,
    needsRegistration: isNear && !isChecking && isRegistered === false,
    blocksAction: isNear && (isChecking || isRegistered === false),
  };
}
