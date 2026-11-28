import type { AssetDepositAction, SpokeChainKey, TxHashPair } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { retryBeforeSubmission } from '../shared/retryBeforeSubmission.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseDexDepositVars<K extends SpokeChainKey = SpokeChainKey> = Omit<AssetDepositAction<K, false>, 'raw'>;

/** Throws on SDK failure (React Query error state); resolves to the unwrapped `TxHashPair`. */
export function useDexDeposit<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseDexDepositVars<K>> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  UseDexDepositVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseDexDepositVars<K>>({
    mutationKey: ['dex', 'deposit'],
    ...mutationOptions,
    retry: retryBeforeSubmission(
      mutationOptions?.retry ??
        queryClient.getMutationDefaults?.(mutationOptions?.mutationKey ?? ['dex', 'deposit'])?.retry ??
        queryClient.getDefaultOptions?.().mutations?.retry,
    ),
    mutationFn: async vars => unwrapResult(await sodax.dex.assetService.deposit({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({ queryKey: ['dex', 'poolBalances', params.srcChainKey, params.srcAddress] });
      queryClient.invalidateQueries({
        queryKey: ['dex', 'allowance', params.srcChainKey, params.asset, params.amount.toString()],
      });
      invalidateBalances(queryClient, params.srcChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
