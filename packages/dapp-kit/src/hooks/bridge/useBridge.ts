// packages/dapp-kit/src/hooks/bridge/useBridge.ts
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { BridgeParams, SpokeChainKey, TxHashPair } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useBridge}. Generic over `K extends SpokeChainKey` (defaults to
 * the full union). Sophisticated callers can lock K at the hook call site to narrow the
 * `walletProvider` and `params.srcChainKey` types.
 */
export type UseBridgeVars<K extends SpokeChainKey = SpokeChainKey> = Omit<BridgeParams<K, false>, 'raw'>;

/**
 * React hook for executing a cross-chain bridge transfer.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped `TxHashPair` on success.
 */
export function useBridge<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseBridgeVars<K>> = {}): SafeUseMutationResult<TxHashPair, Error, UseBridgeVars<K>> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseBridgeVars<K>>({
    mutationKey: ['bridge'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.bridge.bridge({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      invalidateBalances(queryClient, vars.params.srcChainKey, vars.params.dstChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
