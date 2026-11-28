import type { CancelUnstakeAction, SpokeChainKey, TxHashPair } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseCancelUnstakeVars<K extends SpokeChainKey = SpokeChainKey> = Omit<CancelUnstakeAction<K, false>, 'raw'>;

/** Throws on SDK failure (React Query error state); resolves to the unwrapped `TxHashPair`. */
export function useCancelUnstake<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseCancelUnstakeVars<K>> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  UseCancelUnstakeVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseCancelUnstakeVars<K>>({
    mutationKey: ['staking', 'cancelUnstake'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.staking.cancelUnstake({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({ queryKey: ['staking', 'unstakingInfo', params.srcChainKey, params.srcAddress] });
      queryClient.invalidateQueries({
        queryKey: ['staking', 'unstakingInfoWithPenalty', params.srcChainKey, params.srcAddress],
      });
      queryClient.invalidateQueries({ queryKey: ['staking', 'info', params.srcChainKey, params.srcAddress] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
