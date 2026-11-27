import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { BridgeParams, SpokeChainKey, TxHashPair } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import { retryBeforeSubmission } from '../shared/retryBeforeSubmission.js';

/** Lock `K` at the call site to narrow `walletProvider` and `params.srcChainKey`. */
export type UseBridgeVars<K extends SpokeChainKey = SpokeChainKey> = Omit<BridgeParams<K, false>, 'raw'>;

/** Throws on SDK failure; resolves to the unwrapped `TxHashPair` and invalidates balances. */
export function useBridge<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseBridgeVars<K>> = {}): SafeUseMutationResult<TxHashPair, Error, UseBridgeVars<K>> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseBridgeVars<K>>({
    mutationKey: ['bridge'],
    ...mutationOptions,
    retry: retryBeforeSubmission(
      mutationOptions?.retry ??
        queryClient.getMutationDefaults?.(mutationOptions?.mutationKey ?? ['bridge'])?.retry ??
        queryClient.getDefaultOptions?.().mutations?.retry,
    ),
    mutationFn: async vars => unwrapResult(await sodax.bridge.bridge({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      invalidateBalances(queryClient, vars.params.srcChainKey, vars.params.dstChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
