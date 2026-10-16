// packages/dapp-kit/src/hooks/dex/useDexWithdraw.ts
import type { AssetWithdrawAction, SpokeChainKey, TxHashPair } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useDexWithdraw}. Generic over `K extends SpokeChainKey` (defaults
 * to the full union). Sophisticated callers can lock K at the hook call site to narrow the
 * `walletProvider` and `params.srcChainKey` types.
 */
export type UseDexWithdrawVars<K extends SpokeChainKey = SpokeChainKey> = Omit<AssetWithdrawAction<K, false>, 'raw'>;

/**
 * React hook for withdrawing an asset from a DEX pool.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped `TxHashPair` on success.
 */
export function useDexWithdraw<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseDexWithdrawVars<K>> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  UseDexWithdrawVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseDexWithdrawVars<K>>({
    mutationKey: ['dex', 'withdraw'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.dex.assetService.withdraw({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({ queryKey: ['dex', 'poolBalances', params.srcChainKey, params.srcAddress] });
      invalidateBalances(queryClient, params.srcChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
