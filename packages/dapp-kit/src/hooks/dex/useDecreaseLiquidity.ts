import type { ClLiquidityDecreaseLiquidityAction, SpokeChainKey, TxHashPair } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseDecreaseLiquidityVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  ClLiquidityDecreaseLiquidityAction<K, false>,
  'raw'
>;

/** Throws on SDK failure (React Query error state); resolves to the unwrapped `TxHashPair`. */
export function useDecreaseLiquidity<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseDecreaseLiquidityVars<K>> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  UseDecreaseLiquidityVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseDecreaseLiquidityVars<K>>({
    mutationKey: ['dex', 'decreaseLiquidity'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.dex.clService.decreaseLiquidity({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      // Scope invalidation to this position; `usePositionInfo` keys by string tokenId, so stringify the bigint.
      queryClient.invalidateQueries({
        queryKey: ['dex', 'positionInfo', params.tokenId.toString(), params.poolKey],
      });
      queryClient.invalidateQueries({ queryKey: ['dex', 'poolData', params.poolKey] });
      queryClient.invalidateQueries({ queryKey: ['dex', 'poolBalances', params.srcChainKey, params.srcAddress] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
