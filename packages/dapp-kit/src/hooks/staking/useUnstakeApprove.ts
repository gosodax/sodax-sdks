import type { GetWalletProviderType, SpokeChainKey, TxReturnType, UnstakeParams } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseUnstakeApproveVars<K extends SpokeChainKey = SpokeChainKey> = {
  params: Omit<UnstakeParams<K>, 'action'>;
  walletProvider: GetWalletProviderType<K>;
};

/** Throws on SDK failure (React Query error state); resolves to the unwrapped tx return value. */
export function useUnstakeApprove<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseUnstakeApproveVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseUnstakeApproveVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseUnstakeApproveVars<K>>({
    mutationKey: ['staking', 'approve', 'unstake'],
    ...mutationOptions,
    mutationFn: async ({ params, walletProvider }) =>
      unwrapResult(
        await sodax.staking.approve({
          params: { ...params, action: 'unstake' },
          raw: false,
          walletProvider,
        }),
      ),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['staking', 'allowance', vars.params.srcChainKey, 'unstake'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
