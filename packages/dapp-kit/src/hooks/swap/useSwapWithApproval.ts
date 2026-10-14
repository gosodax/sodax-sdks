import { useQueryClient } from '@tanstack/react-query';
import type { SpokeChainKey, SwapWithApprovalParams, SwapWithApprovalResponse } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/** Mutation variables for {@link useSwapWithApproval}: `useSwap`'s, plus `allowAccountUpgrade` and `resumeBatchId`. */
export type UseSwapWithApprovalVars<K extends SpokeChainKey = SpokeChainKey> = Omit<SwapWithApprovalParams<K>, 'raw'>;

/**
 * `useSwap` with the source-token approval folded in (`sodax.swaps.swapWithApproval`): no approval
 * when the allowance suffices, approve + swap as one EIP-5792 batch (one signature) on a
 * batch-capable EVM wallet, otherwise approve, wait for it, then swap. `data.approvalStrategy`
 * says which ran; {@link useSwapApprovalStrategy} predicts it.
 *
 * Throws on SDK failure so React Query's error model engages. On success invalidates balances and
 * the swap allowance and approval-strategy queries.
 */
export function useSwapWithApproval<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<SwapWithApprovalResponse, UseSwapWithApprovalVars<K>> = {}): SafeUseMutationResult<
  SwapWithApprovalResponse,
  Error,
  UseSwapWithApprovalVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<SwapWithApprovalResponse, Error, UseSwapWithApprovalVars<K>>({
    mutationKey: ['swap', 'swapWithApproval'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.swaps.swapWithApproval({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      invalidateBalances(queryClient, vars.params.srcChainKey, vars.params.dstChainKey);
      queryClient.invalidateQueries({ queryKey: ['swap', 'allowance'] });
      queryClient.invalidateQueries({ queryKey: ['swap', 'approvalStrategy'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
