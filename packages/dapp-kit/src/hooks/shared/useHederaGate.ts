import { ChainKeys, type GetWalletProviderType, type Hash, type Result, type SpokeChainKey } from '@sodax/sdk';
import { resolveHederaGate, type HederaGateState } from '../../utils/hederaGate.js';
import { useEstablishHederaAssociation } from './useEstablishHederaAssociation.js';
import { useHederaDestinationCheck } from './useHederaDestinationCheck.js';
import { useSodaxContext } from './useSodaxContext.js';

export interface UseHederaGateParams {
  dstChainKey: SpokeChainKey | undefined;
  token: string | undefined;
  /** The Hedera EVM address that receives the payout. */
  address: string | undefined;
  /** Must control `address`: `requestAssociation` refuses, before signing, a wallet connected to another account. */
  walletProvider: GetWalletProviderType<SpokeChainKey> | undefined;
}

export interface HederaGate extends HederaGateState {
  isChecking: boolean;
  /** Surface when `checkFailed` is true. */
  error: Error | undefined;
  retry: () => void;
  isRequestingAssociation: boolean;
  /** Associates exactly `token`. Returns `undefined` when required inputs are missing. */
  requestAssociation: () => Promise<Result<Hash> | undefined>;
}

/**
 * Gate Hedera delivery of an HTS token on the destination account being associated with it. Refusals no
 * association fixes (no account, frozen, KYC not granted) surface as `blockedReason`.
 */
export function useHederaGate({ dstChainKey, token, address, walletProvider }: UseHederaGateParams): HederaGate {
  const { sodax } = useSodaxContext();
  const isHederaDestination = dstChainKey === ChainKeys.HEDERA_MAINNET;
  const requiresAssociation = isHederaDestination && !!token && sodax.spoke.hedera.requiresAssociation(token);
  const evmWalletProvider = walletProvider?.chainType === 'EVM' ? walletProvider : undefined;

  const readinessCheck = useHederaDestinationCheck({
    params: { chainId: requiresAssociation ? dstChainKey : undefined, token, address },
  });

  const state = resolveHederaGate(dstChainKey, { readinessCheck, requiresAssociation });

  const { mutateAsyncSafe: establishAssociation, isPending: isRequestingAssociation } = useEstablishHederaAssociation();

  const requestAssociation = async (): Promise<Result<Hash> | undefined> => {
    if (!evmWalletProvider || !token || !address) return undefined;
    return establishAssociation({ token, address, walletProvider: evmWalletProvider });
  };

  const retry = (): void => {
    void readinessCheck.refetch();
  };

  return {
    ...state,
    isChecking: readinessCheck.isLoading,
    error: readinessCheck.error ?? undefined,
    retry,
    isRequestingAssociation,
    requestAssociation,
  };
}
