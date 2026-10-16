// packages/dapp-kit/src/hooks/mm/useBorrow.ts
import type { MoneyMarketBorrowActionParams, SpokeChainKey, TxHashPair } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useBorrow}. Generic over `K extends SpokeChainKey` (defaults to
 * the full union). Sophisticated callers can lock K at the hook call site to narrow the
 * `walletProvider` and `params.srcChainKey` types.
 */
export type UseBorrowVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  MoneyMarketBorrowActionParams<K, false>,
  'raw'
>;

/**
 * React hook for borrowing tokens from the Sodax money market protocol.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped `TxHashPair` on success.
 */
export function useBorrow<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseBorrowVars<K>> = {}): SafeUseMutationResult<TxHashPair, Error, UseBorrowVars<K>> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseBorrowVars<K>>({
    mutationKey: ['mm', 'borrow'],
    ...mutationOptions,
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
