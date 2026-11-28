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
  /** True while the check is unresolved or registration is needed. */
  blocksAction: boolean;
}

/** NEAR analogue of the Stellar trustline gate. Reads `isLoading`, not `isPending` (stays true for a disabled query);
 * `blocksAction` also covers the in-flight check, while `needsRegistration` waits for it to resolve. */
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
