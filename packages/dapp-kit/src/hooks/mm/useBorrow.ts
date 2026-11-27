import type { MoneyMarketBorrowActionParams, SpokeChainKey, OutboundSettlement } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import { retryBeforeSubmission } from '../shared/retryBeforeSubmission.js';

export type UseBorrowVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  MoneyMarketBorrowActionParams<K, false>,
  'raw'
>;

/** Throws on SDK failure; resolves to an {@link OutboundSettlement} (tx pair, or Tron relay `trackingId` + dst tx). */
export function useBorrow<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<OutboundSettlement<K>, UseBorrowVars<K>> = {}): SafeUseMutationResult<
  OutboundSettlement<K>,
  Error,
  UseBorrowVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<OutboundSettlement<K>, Error, UseBorrowVars<K>>({
    mutationKey: ['mm', 'borrow'],
    ...mutationOptions,
    retry: retryBeforeSubmission(
      mutationOptions?.retry ??
        queryClient.getMutationDefaults?.(mutationOptions?.mutationKey ?? ['mm', 'borrow'])?.retry ??
        queryClient.getDefaultOptions?.().mutations?.retry,
    ),
    mutationFn: async vars => unwrapResult(await sodax.moneyMarket.borrow({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({ queryKey: ['mm', 'userReservesData', params.srcChainKey, params.srcAddress] });
      queryClient.invalidateQueries({
        queryKey: ['mm', 'userFormattedSummary', params.srcChainKey, params.srcAddress],
      });
      queryClient.invalidateQueries({ queryKey: ['mm', 'aTokensBalances'] });
      invalidateBalances(queryClient, params.srcChainKey, params.dstChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
