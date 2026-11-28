import type { GetWalletProviderType, SpokeChainKey, StakeParams, TxReturnType } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseStakeApproveVars<K extends SpokeChainKey = SpokeChainKey> = {
  params: Omit<StakeParams<K>, 'action'>;
  walletProvider: GetWalletProviderType<K>;
};

/** Throws on SDK failure (React Query error state); resolves to the unwrapped tx return value. */
export function useStakeApprove<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseStakeApproveVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseStakeApproveVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseStakeApproveVars<K>>({
    mutationKey: ['staking', 'approve', 'stake'],
    ...mutationOptions,
    mutationFn: async ({ params, walletProvider }) =>
      unwrapResult(
        await sodax.staking.approve({
          params: { ...params, action: 'stake' },
          raw: false,
          walletProvider,
        }),
      ),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['staking', 'allowance', vars.params.srcChainKey, 'stake'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
