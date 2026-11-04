import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { CreateIntentParams, GetWalletProviderType, SpokeChainKey, SwapApprovalStrategy } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseSwapApprovalStrategyParams<K extends SpokeChainKey = SpokeChainKey> = ReadHookParams<
  SwapApprovalStrategy,
  {
    payload: CreateIntentParams<K> | undefined;
    walletProvider: GetWalletProviderType<K> | undefined;
    /** `false` keeps a wallet that would first ask to upgrade the account (EIP-5792 `'ready'`) off the batch path. Defaults to `true`. */
    allowAccountUpgrade?: boolean;
  }
>;

/**
 * Which approval path {@link useSwapWithApproval} would take for this swap: `'not-required'`,
 * `'atomic-batch'` (approve + swap in one EIP-5792 signature) or `'sequential'` (approve, then
 * swap). Use it to label the swap button before the user clicks. Pass the same `allowAccountUpgrade`
 * you give the swap.
 *
 * Not polled: `useSwapWithApproval` invalidates it after a successful swap, and the swap itself
 * re-reads the strategy at execution, so a stale label never picks the wrong path.
 */
export function useSwapApprovalStrategy<K extends SpokeChainKey = SpokeChainKey>({
  params,
  queryOptions,
}: UseSwapApprovalStrategyParams<K> = {}): UseQueryResult<SwapApprovalStrategy, Error> {
  const { sodax } = useSodaxContext();
  const payload = params?.payload;
  const walletProvider = params?.walletProvider;
  const allowAccountUpgrade = params?.allowAccountUpgrade ?? true;

  return useQuery<SwapApprovalStrategy, Error>({
    queryKey: [
      'swap',
      'approvalStrategy',
      payload?.srcChainKey,
      payload?.srcAddress,
      payload?.inputToken,
      payload?.inputAmount.toString(),
      allowAccountUpgrade,
    ],
    queryFn: async () => {
      if (!payload || !walletProvider) throw new Error('payload and walletProvider are required');
      return unwrapResult(
        await sodax.swaps.getApprovalStrategy({ params: payload, walletProvider, allowAccountUpgrade }),
      );
    },
    enabled: !!payload && !!walletProvider,
    ...queryOptions,
  });
}
