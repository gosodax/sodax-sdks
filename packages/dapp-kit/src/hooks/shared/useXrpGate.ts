import { ChainKeys, type GetWalletProviderType, type Result, type SpokeChainKey } from '@sodax/sdk';
import { resolveXrpGate, type XrpGateState } from '../../utils/xrpGate.js';
import { useEstablishXrpTrustline } from './useEstablishXrpTrustline.js';
import { useSodaxContext } from './useSodaxContext.js';
import { useXrpDestinationCheck } from './useXrpDestinationCheck.js';
import { useXrpTrustlineReserveCheck } from './useXrpTrustlineReserveCheck.js';

export interface UseXrpGateParams {
  dstChainKey: SpokeChainKey | undefined;
  token: string | undefined;
  address: string | undefined;
  /** The least that arrives, in the token's decimals. */
  amount: bigint | undefined;
  /** The most that can arrive, which the trustline needs room for. Defaults to `amount`. */
  maxAmount?: bigint;
  /** Must control `address`: `requestTrustline` refuses, before signing, a wallet connected to another account. */
  walletProvider: GetWalletProviderType<SpokeChainKey> | undefined;
}

export interface XrpGate extends XrpGateState {
  isChecking: boolean;
  /** Surface when `checkFailed` is true. */
  error: Error | undefined;
  retry: () => void;
  isRequestingTrustline: boolean;
  /** Returns `undefined` when required inputs are missing. */
  requestTrustline: () => Promise<Result<string> | undefined>;
}

/**
 * Gates XRPL delivery on a trustline with room for the payout and enough XRP to set one. Refusals a
 * trustline cannot fix surface as `blockedReason`.
 */
export function useXrpGate({
  dstChainKey,
  token,
  address,
  amount,
  maxAmount,
  walletProvider,
}: UseXrpGateParams): XrpGate {
  const { sodax } = useSodaxContext();
  const isXrpDestination = dstChainKey === ChainKeys.XRP_MAINNET;
  const requiresTrustline = isXrpDestination && !!token && sodax.spoke.xrp.requiresTrustline(token);
  const xrpWalletProvider = walletProvider?.chainType === 'XRP' ? walletProvider : undefined;

  const readinessCheck = useXrpDestinationCheck({
    params: { chainId: requiresTrustline ? dstChainKey : undefined, token, address, amount, maxAmount },
  });
  const trustlineReason =
    readinessCheck.data?.ready === false &&
    (readinessCheck.data.reason === 'no_trustline' || readinessCheck.data.reason === 'trustline_limit');
  // Read the reserve only once the trustline is known to need setting.
  const reserveCheck = useXrpTrustlineReserveCheck({
    params: { token: trustlineReason ? token : undefined, address: trustlineReason ? address : undefined },
  });

  const state = resolveXrpGate(dstChainKey, { readinessCheck, reserveCheck, requiresTrustline });

  const { mutateAsyncSafe: establishTrustline, isPending: isRequestingTrustline } = useEstablishXrpTrustline();

  const requestTrustline = async (): Promise<Result<string> | undefined> => {
    if (!xrpWalletProvider || !token || !address) return undefined;
    return establishTrustline({ token, address, walletProvider: xrpWalletProvider });
  };

  const retry = (): void => {
    void readinessCheck.refetch();
    if (trustlineReason) void reserveCheck.refetch();
  };

  return {
    ...state,
    isChecking: readinessCheck.isLoading || reserveCheck.isLoading,
    error: readinessCheck.error ?? reserveCheck.error ?? undefined,
    retry,
    isRequestingTrustline,
    requestTrustline,
  };
}
