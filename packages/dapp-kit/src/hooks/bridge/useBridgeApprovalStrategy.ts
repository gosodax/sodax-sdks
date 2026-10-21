import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ApprovalStrategy, CreateBridgeIntentParams, GetWalletProviderType, SpokeChainKey } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseBridgeApprovalStrategyParams<K extends SpokeChainKey = SpokeChainKey> = ReadHookParams<
  ApprovalStrategy,
  {
    payload: CreateBridgeIntentParams<K> | undefined;
    walletProvider: GetWalletProviderType<K> | undefined;
    /** `false` keeps a wallet that would first ask to upgrade the account (EIP-5792 `'ready'`) off the batch path. Defaults to `true`. */
    allowAccountUpgrade?: boolean;
  }
>;

/**
 * Which approval path {@link useBridgeWithApproval} would take for this bridge: `'not-required'`,
 * `'atomic-batch'` (approve + deposit in one EIP-5792 signature) or `'sequential'` (approve, then
 * bridge). Use it to label the bridge button. Pass the same `allowAccountUpgrade` you give the bridge.
 *
 * Not polled: `useBridgeWithApproval` invalidates it after a successful bridge, and the bridge
 * re-reads the strategy at execution, so a stale label never picks the wrong path.
 */
export function useBridgeApprovalStrategy<K extends SpokeChainKey = SpokeChainKey>({
  params,
  queryOptions,
}: UseBridgeApprovalStrategyParams<K> = {}): UseQueryResult<ApprovalStrategy, Error> {
  const { sodax } = useSodaxContext();
  const payload = params?.payload;
  const walletProvider = params?.walletProvider;
  const allowAccountUpgrade = params?.allowAccountUpgrade ?? true;

  return useQuery<ApprovalStrategy, Error>({
    queryKey: [
      'bridge',
      'approvalStrategy',
      payload?.srcChainKey,
      payload?.srcAddress,
      payload?.srcToken,
      payload?.amount.toString(),
      allowAccountUpgrade,
    ],
    queryFn: async () => {
      if (!payload || !walletProvider) throw new Error('payload and walletProvider are required');
      return unwrapResult(
        await sodax.bridge.getApprovalStrategy({ params: payload, walletProvider, allowAccountUpgrade }),
      );
    },
    enabled: !!payload && !!walletProvider,
    ...queryOptions,
  });
}
