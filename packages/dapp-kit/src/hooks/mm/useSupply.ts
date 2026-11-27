import type { MoneyMarketSupplyActionParams, SpokeChainKey, TxHashPair } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { retryBeforeSubmission } from '../shared/retryBeforeSubmission.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseSupplyVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  MoneyMarketSupplyActionParams<K, false>,
  'raw'
>;

/** Throws on SDK failure (React Query error state); resolves to the unwrapped `TxHashPair`. */
export function useSupply<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseSupplyVars<K>> = {}): SafeUseMutationResult<TxHashPair, Error, UseSupplyVars<K>> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseSupplyVars<K>>({
    mutationKey: ['mm', 'supply'],
    ...mutationOptions,
    retry: retryBeforeSubmission(
      mutationOptions?.retry ??
        queryClient.getMutationDefaults?.(mutationOptions?.mutationKey ?? ['mm', 'supply'])?.retry ??
        queryClient.getDefaultOptions?.().mutations?.retry,
    ),
    mutationFn: async vars => unwrapResult(await sodax.moneyMarket.supply({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({ queryKey: ['mm', 'userReservesData', params.srcChainKey, params.srcAddress] });
      queryClient.invalidateQueries({
        queryKey: ['mm', 'userFormattedSummary', params.srcChainKey, params.srcAddress],
      });
      queryClient.invalidateQueries({ queryKey: ['mm', 'aTokensBalances'] });
      queryClient.invalidateQueries({ queryKey: ['mm', 'allowance', params.srcChainKey, params.token, params.action] });
      invalidateBalances(queryClient, params.srcChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
