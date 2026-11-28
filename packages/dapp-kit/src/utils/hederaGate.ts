import {
  ChainKeys,
  getEvmViemChain,
  type GetWalletProviderType,
  type HederaDestinationReadiness,
  type Result,
  type SpokeChainKey,
} from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';

/** The subset of a query result the gate reads. A full `UseQueryResult<T>` satisfies it. */
export type HederaCheckResult<T> = Pick<UseQueryResult<T>, 'isLoading' | 'isError' | 'data'>;

/** A destination refusal the account's own association cannot fix. */
export type HederaBlockedReason = Exclude<
  Extract<HederaDestinationReadiness, { ready: false }>['reason'],
  'not_associated'
>;

export interface HederaGateState {
  /** The destination is Hedera and the token is an HTS token, so an association is involved. */
  isHederaHtsToken: boolean;
  /** The account is not associated with the token; associating it clears the gate. */
  needsAssociation: boolean;
  /** Why the destination cannot receive, when no association by the user would fix it. */
  blockedReason: HederaBlockedReason | undefined;
  /** A query failed; disabled or unresolved queries do not set this. */
  checkFailed: boolean;
  /** Whether the downstream action must remain disabled. */
  blocksAction: boolean;
}

export interface HederaGateInputs {
  /** Whether the destination can receive the token, from the same mirror-node reads the SDK refuses a swap on. */
  readinessCheck: HederaCheckResult<HederaDestinationReadiness>;
  /** Resolve from chain config: false for HBAR. */
  requiresAssociation: boolean;
}

const NOT_HEDERA_HTS_TOKEN: HederaGateState = {
  isHederaHtsToken: false,
  needsAssociation: false,
  blockedReason: undefined,
  checkFailed: false,
  blocksAction: false,
};

/**
 * Resolve the Hedera destination prerequisite for an HTS token: an existing association. A free automatic
 * association slot does not count, because the relay's delivery cannot pay for using it. HBAR and other
 * chains pass through. Unknown states fail closed.
 */
export function resolveHederaGate(chainKey: SpokeChainKey | undefined, inputs: HederaGateInputs): HederaGateState {
  const { readinessCheck, requiresAssociation } = inputs;
  if (chainKey !== ChainKeys.HEDERA_MAINNET || !requiresAssociation) return NOT_HEDERA_HTS_TOKEN;
  const base = { ...NOT_HEDERA_HTS_TOKEN, isHederaHtsToken: true };

  if (readinessCheck.isError) return { ...base, checkFailed: true, blocksAction: true };
  const readiness = readinessCheck.data;
  if (readinessCheck.isLoading || readiness === undefined) return { ...base, blocksAction: true };
  if (readiness.ready) return base;
  if (readiness.reason === 'not_associated') return { ...base, needsAssociation: true, blocksAction: true };
  return { ...base, blockedReason: readiness.reason, blocksAction: true };
}

/**
 * Moves an EVM wallet that can report and switch its chain onto Hedera, which sends the association.
 * `undefined` means there is nothing to switch (already on Hedera, or the wallet cannot switch), so the
 * association can be sent now. A refused or failed switch comes back as a failed `Result`.
 */
export async function switchWalletToHedera(
  walletProvider: GetWalletProviderType<SpokeChainKey> | undefined,
): Promise<Result<void> | undefined> {
  if (walletProvider?.chainType !== 'EVM' || !walletProvider.getChainId || !walletProvider.switchChain) return undefined;
  const hederaChainId = getEvmViemChain(ChainKeys.HEDERA_MAINNET).id;
  try {
    if ((await walletProvider.getChainId()) === hederaChainId) return undefined;
    await walletProvider.switchChain(hederaChainId);
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, error };
  }
}
