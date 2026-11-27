import type { AssetDepositAction, SpokeChainKey, TxReturnType } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseDexApproveVars<K extends SpokeChainKey = SpokeChainKey> = Omit<AssetDepositAction<K, false>, 'raw'>;

/** Throws on SDK failure (React Query error state); resolves to the unwrapped tx return value. */
export function useDexApprove<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseDexApproveVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseDexApproveVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseDexApproveVars<K>>({
    mutationKey: ['dex', 'approve'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.dex.assetService.approve({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({
        queryKey: ['dex', 'allowance', params.srcChainKey, params.asset, params.amount.toString()],
      });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
