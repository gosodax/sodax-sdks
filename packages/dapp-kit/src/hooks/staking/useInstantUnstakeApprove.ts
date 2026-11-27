import type { GetWalletProviderType, InstantUnstakeParams, SpokeChainKey, TxReturnType } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseInstantUnstakeApproveVars<K extends SpokeChainKey = SpokeChainKey> = {
  params: Omit<InstantUnstakeParams<K>, 'action'>;
  walletProvider: GetWalletProviderType<K>;
};

/** Throws on SDK failure (React Query error state); resolves to the unwrapped tx return value. */
export function useInstantUnstakeApprove<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseInstantUnstakeApproveVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseInstantUnstakeApproveVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseInstantUnstakeApproveVars<K>>({
    mutationKey: ['staking', 'approve', 'instantUnstake'],
    ...mutationOptions,
    mutationFn: async ({ params, walletProvider }) =>
      unwrapResult(
        await sodax.staking.approve({
          params: { ...params, action: 'instantUnstake' },
          raw: false,
          walletProvider,
        }),
      ),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({
        queryKey: ['staking', 'allowance', vars.params.srcChainKey, 'instantUnstake'],
      });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
