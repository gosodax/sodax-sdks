import type { SpokeChainKey, SendMessageReturnType, WithdrawHubAssetAction } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { retryBeforeSubmission } from '../shared/retryBeforeSubmission.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseWithdrawHubAssetVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  WithdrawHubAssetAction<K, false>,
  'raw'
>;

/** Resolves the spoke tx hash, or for an MPC-relay chain a relay `trackingId` that is not a tx hash. */
export function useWithdrawHubAsset<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<SendMessageReturnType<K, false>, UseWithdrawHubAssetVars<K>> = {}): SafeUseMutationResult<
  SendMessageReturnType<K, false>,
  Error,
  UseWithdrawHubAssetVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<SendMessageReturnType<K, false>, Error, UseWithdrawHubAssetVars<K>>({
    mutationKey: ['recovery', 'withdrawHubAsset'],
    ...mutationOptions,
    retry: retryBeforeSubmission(
      mutationOptions?.retry ??
        queryClient.getMutationDefaults?.(mutationOptions?.mutationKey ?? ['recovery', 'withdrawHubAsset'])?.retry ??
        queryClient.getDefaultOptions?.().mutations?.retry,
    ),
    mutationFn: async vars => unwrapResult(await sodax.recovery.withdrawHubAsset<K, false>({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({
        queryKey: ['recovery', 'hubAssetBalances', params.srcChainKey, params.srcAddress],
      });
      invalidateBalances(queryClient, params.srcChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
