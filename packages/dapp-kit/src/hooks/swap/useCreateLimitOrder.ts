import { useQueryClient } from '@tanstack/react-query';
// packages/dapp-kit/src/hooks/swap/useCreateLimitOrder.ts
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { LimitOrderActionParams, SpokeChainKey, SwapResponse } from '@sodax/sdk';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { retryBeforeSubmission } from '../shared/retryBeforeSubmission.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useCreateLimitOrder}. Generic over `K extends SpokeChainKey`
 * (defaults to the full union). Sophisticated callers can lock K at the call site to narrow the
 * `walletProvider` and `params.srcChainKey` types.
 */
export type UseCreateLimitOrderVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  LimitOrderActionParams<K, false>,
  'raw'
>;

/**
 * React hook for creating a limit-order intent (no deadline).
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped `SwapResponse` on success.
 */
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
