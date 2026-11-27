import { useSodaxContext } from '../shared/useSodaxContext.js';
import { useQueryClient } from '@tanstack/react-query';
import type {
  CreateIntentParams,
  CreateLimitOrderParams,
  GetWalletProviderType,
  SpokeChainKey,
  TxReturnType,
} from '@sodax/sdk';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/** Lock `K` at the call site to narrow `walletProvider` and `params.srcChainKey`. */
export type UseSwapApproveVars<K extends SpokeChainKey = SpokeChainKey> = {
  params: CreateIntentParams<K> | CreateLimitOrderParams<K>;
  walletProvider: GetWalletProviderType<K>;
};

/** Approves spending (or sets a trustline). Throws on SDK failure; invalidates `['swap', 'allowance']` on success. */
export function useSwapApprove<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseSwapApproveVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseSwapApproveVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseSwapApproveVars<K>>({
    mutationKey: ['swap', 'approve'],
    ...mutationOptions,
    mutationFn: async ({ params, walletProvider }) =>
      unwrapResult(
        await sodax.swaps.approve<K, false>({
          params: params as CreateIntentParams<K>,
          raw: false,
          walletProvider,
        }),
      ),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['swap', 'allowance'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
