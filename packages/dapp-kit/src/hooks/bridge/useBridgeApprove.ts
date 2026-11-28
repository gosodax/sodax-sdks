import type { BridgeParams, SpokeChainKey, TxReturnType } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/** Lock `K` at the call site to narrow `walletProvider` and `params.srcChainKey`. */
export type UseBridgeApproveVars<K extends SpokeChainKey = SpokeChainKey> = Omit<BridgeParams<K, false>, 'raw'>;

/** Approves spending (or sets a trustline). Throws on SDK failure; invalidates `['bridge', 'allowance']` on success. */
export function useBridgeApprove<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseBridgeApproveVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseBridgeApproveVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseBridgeApproveVars<K>>({
    mutationKey: ['bridge', 'approve'],
    ...mutationOptions,
    mutationFn: async vars =>
      unwrapResult(await sodax.bridge.approve({ ...vars, raw: false } as BridgeParams<K, false>)),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['bridge', 'allowance'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
