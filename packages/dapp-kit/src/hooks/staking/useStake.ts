import type { SpokeChainKey, StakeAction, TxHashPair } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseStakeVars<K extends SpokeChainKey = SpokeChainKey> = Omit<StakeAction<K, false>, 'raw'>;

/** Throws on SDK failure (React Query error state); resolves to the unwrapped `TxHashPair`. */
export function useStake<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseStakeVars<K>> = {}): SafeUseMutationResult<TxHashPair, Error, UseStakeVars<K>> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseStakeVars<K>>({
    mutationKey: ['staking', 'stake'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.staking.stake({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({ queryKey: ['staking', 'info', params.srcChainKey, params.srcAddress] });
      queryClient.invalidateQueries({ queryKey: ['staking', 'allowance', params.srcChainKey, 'stake'] });
      queryClient.invalidateQueries({ queryKey: ['staking', 'stakeRatio'] });
      queryClient.invalidateQueries({ queryKey: ['staking', 'convertedAssets'] });
      invalidateBalances(queryClient, params.srcChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
