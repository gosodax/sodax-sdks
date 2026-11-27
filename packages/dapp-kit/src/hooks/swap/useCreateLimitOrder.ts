import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { LimitOrderActionParams, SpokeChainKey, SwapResponse } from '@sodax/sdk';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { retryBeforeSubmission } from '../shared/retryBeforeSubmission.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/** Lock `K` at the call site to narrow `walletProvider` and `params.srcChainKey`. */
export type UseCreateLimitOrderVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  LimitOrderActionParams<K, false>,
  'raw'
>;

/** Creates a limit order (no deadline). Throws on SDK failure; resolves to the unwrapped `SwapResponse`. */
export function useCreateLimitOrder<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<SwapResponse, UseCreateLimitOrderVars<K>> = {}): SafeUseMutationResult<
  SwapResponse,
  Error,
  UseCreateLimitOrderVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<SwapResponse, Error, UseCreateLimitOrderVars<K>>({
    mutationKey: ['swap', 'limitOrder', 'create'],
    ...mutationOptions,
    retry: retryBeforeSubmission(
      mutationOptions?.retry ??
        queryClient.getMutationDefaults?.(mutationOptions?.mutationKey ?? ['swap', 'limitOrder', 'create'])?.retry ??
        queryClient.getDefaultOptions?.().mutations?.retry,
    ),
    mutationFn: async vars => unwrapResult(await sodax.swaps.createLimitOrder({ ...vars, raw: false })),
  });
}
