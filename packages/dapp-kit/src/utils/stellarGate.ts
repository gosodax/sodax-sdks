import { ChainKeys, type SpokeChainKey, type StellarAccountStatus } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';

/** Reads `isLoading` because `isPending` stays true for disabled queries; errors stay distinct from unmet prerequisites. */
export type StellarCheckResult<T> = Pick<UseQueryResult<T>, 'isLoading' | 'isError' | 'data'>;

export interface StellarGateState {
  isStellar: boolean;
  needsActivation: boolean;
  /** Never set for native XLM or an existing trustline. */
  needsFunding: boolean;
  needsTrustline: boolean;
  /** A query failed; disabled or unresolved queries do not set this. */
  checkFailed: boolean;
  /** Whether the downstream action must remain disabled. */
  blocksAction: boolean;
}

export interface StellarGateInputs {
  /** Account existence and spending capacity from one Horizon read. */
  statusCheck: StellarCheckResult<StellarAccountStatus>;
  trustlineCheck: StellarCheckResult<boolean>;
  /** Resolve from chain config, never by comparing token symbols. */
  isNativeToken: boolean;
}

function unresolved<T>(check: StellarCheckResult<T>): boolean {
  return check.isLoading || check.data === undefined;
}

const NOT_STELLAR: StellarGateState = {
  isStellar: false,
  needsActivation: false,
  needsFunding: false,
  needsTrustline: false,
  checkFailed: false,
  blocksAction: false,
};

/** Checks the trustline before affordability because an existing trustline needs no extra XLM. Unknown states fail closed. */
export function resolveStellarGate(chainKey: SpokeChainKey | undefined, inputs: StellarGateInputs): StellarGateState {
  const { statusCheck, trustlineCheck, isNativeToken } = inputs;

  if (chainKey !== ChainKeys.STELLAR_MAINNET) return NOT_STELLAR;
  const base = {
    isStellar: true,
    needsActivation: false,
    needsFunding: false,
    needsTrustline: false,
    checkFailed: false,
  };

  // A failed read is unknown, not evidence that activation is needed.
  if (statusCheck.isError) return { ...base, checkFailed: true, blocksAction: true };
  const status = statusCheck.data;
  if (statusCheck.isLoading || status === undefined) return { ...base, blocksAction: true };

  if (!status.exists) return { ...base, needsActivation: true, blocksAction: true };

  // Native XLM can fund an activated zero-balance account without a trustline.
  if (isNativeToken) return { ...base, blocksAction: false };

  if (trustlineCheck.isError) return { ...base, checkFailed: true, blocksAction: true };
  if (unresolved(trustlineCheck)) return { ...base, blocksAction: true };

  if (trustlineCheck.data === true) return { ...base, blocksAction: false };

  if (!status.canAffordTrustline) return { ...base, needsFunding: true, blocksAction: true };

  return { ...base, needsTrustline: true, blocksAction: true };
}
