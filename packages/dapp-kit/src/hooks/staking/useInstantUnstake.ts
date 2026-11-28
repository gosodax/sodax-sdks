import type { InstantUnstakeAction, SpokeChainKey, TxHashPair } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseInstantUnstakeVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  InstantUnstakeAction<K, false>,
  'raw'
>;

/** Throws on SDK failure (React Query error state); resolves to the unwrapped `TxHashPair`. */
export function useInstantUnstake<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseInstantUnstakeVars<K>> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  UseInstantUnstakeVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseInstantUnstakeVars<K>>({
    mutationKey: ['staking', 'instantUnstake'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.staking.instantUnstake({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({ queryKey: ['staking', 'info', params.srcChainKey, params.srcAddress] });
      queryClient.invalidateQueries({ queryKey: ['staking', 'instantUnstakeRatio'] });
      queryClient.invalidateQueries({ queryKey: ['staking', 'allowance', params.srcChainKey, 'instantUnstake'] });
      invalidateBalances(queryClient, params.srcChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
