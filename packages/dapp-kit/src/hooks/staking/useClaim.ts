import type { ClaimAction, SpokeChainKey, TxHashPair } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseClaimVars<K extends SpokeChainKey = SpokeChainKey> = Omit<ClaimAction<K, false>, 'raw'>;

/** Throws on SDK failure (React Query error state); resolves to the unwrapped `TxHashPair`. */
export function useClaim<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseClaimVars<K>> = {}): SafeUseMutationResult<TxHashPair, Error, UseClaimVars<K>> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseClaimVars<K>>({
    mutationKey: ['staking', 'claim'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.staking.claim({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({ queryKey: ['staking', 'unstakingInfo', params.srcChainKey, params.srcAddress] });
      queryClient.invalidateQueries({
        queryKey: ['staking', 'unstakingInfoWithPenalty', params.srcChainKey, params.srcAddress],
      });
      invalidateBalances(queryClient, params.srcChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
