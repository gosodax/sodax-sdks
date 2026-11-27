import type { SpokeChainKey, TxHashPair, UnstakeAction } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseUnstakeVars<K extends SpokeChainKey = SpokeChainKey> = Omit<UnstakeAction<K, false>, 'raw'>;

/** Throws on SDK failure (React Query error state); resolves to the unwrapped `TxHashPair`. */
export function useUnstake<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseUnstakeVars<K>> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  UseUnstakeVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseUnstakeVars<K>>({
    mutationKey: ['staking', 'unstake'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.staking.unstake({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({ queryKey: ['staking', 'info', params.srcChainKey, params.srcAddress] });
      // Must match `useUnstakingInfo` / `useUnstakingInfoWithPenalty` query keys.
      queryClient.invalidateQueries({ queryKey: ['staking', 'unstakingInfo', params.srcChainKey, params.srcAddress] });
      queryClient.invalidateQueries({
        queryKey: ['staking', 'unstakingInfoWithPenalty', params.srcChainKey, params.srcAddress],
      });
      queryClient.invalidateQueries({ queryKey: ['staking', 'allowance', params.srcChainKey, 'unstake'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
