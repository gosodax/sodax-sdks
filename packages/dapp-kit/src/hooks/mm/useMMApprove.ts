import type { MoneyMarketApproveActionParams, SpokeChainKey, TxReturnType } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseMMApproveVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  MoneyMarketApproveActionParams<K, false>,
  'raw'
>;

/** Throws on SDK failure; invalidates the matching `['mm', 'allowance', ...]` query on success. */
export function useMMApprove<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseMMApproveVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseMMApproveVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseMMApproveVars<K>>({
    mutationKey: ['mm', 'approve'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.moneyMarket.approve({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({
        queryKey: ['mm', 'allowance', params.srcChainKey, params.token, params.action],
      });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
