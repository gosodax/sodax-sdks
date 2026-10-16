// packages/dapp-kit/src/hooks/mm/useSupply.ts
import type { MoneyMarketSupplyActionParams, SpokeChainKey, TxHashPair } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useSupply}. Generic over `K extends SpokeChainKey` (defaults to
 * the full union). Sophisticated callers can lock K at the hook call site to narrow the
 * `walletProvider` and `params.srcChainKey` types.
 */
export type UseSupplyVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  MoneyMarketSupplyActionParams<K, false>,
  'raw'
>;

/**
 * React hook for supplying tokens to the Sodax money market protocol.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped `TxHashPair` on success.
 *
 * @example
 * ```tsx
 * const walletProvider = useWalletProvider({ xChainId: chainKey });
 * const { mutateAsync: supply, isError, error } = useSupply();
 * if (!walletProvider) return;
 * try {
 *   const { spokeTxHash, hubTxHash } = await supply({ params: supplyParams, walletProvider });
 * } catch (e) {
 *   // surfaced via mutation.error / onError
 * }
 * ```
 */
export function useSupply<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseSupplyVars<K>> = {}): SafeUseMutationResult<TxHashPair, Error, UseSupplyVars<K>> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseSupplyVars<K>>({
    mutationKey: ['mm', 'supply'],
    ...mutationOptions,
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
