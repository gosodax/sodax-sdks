import { useQueryClient } from '@tanstack/react-query';
import type { SpokeChainKey, SwapWithApprovalParams, SwapWithApprovalResponse } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { retryBeforeSubmission } from '../shared/retryBeforeSubmission.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseSwapWithApprovalVars<K extends SpokeChainKey = SpokeChainKey> = Omit<SwapWithApprovalParams<K>, 'raw'>;

/**
 * `useSwap` with approval folded in (one EIP-5792 batch where supported); `data.approvalStrategy` says which path ran.
 * Throws on SDK failure; on success invalidates balances, allowance and approval-strategy queries.
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
    retry: retryBeforeSubmission(
      mutationOptions?.retry ??
        queryClient.getMutationDefaults?.(mutationOptions?.mutationKey ?? ['swap', 'swapWithApproval'])?.retry ??
        queryClient.getDefaultOptions?.().mutations?.retry,
    ),
    mutationFn: async vars => unwrapResult(await sodax.swaps.swapWithApproval({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      invalidateBalances(queryClient, vars.params.srcChainKey, vars.params.dstChainKey);
      queryClient.invalidateQueries({ queryKey: ['swap', 'allowance'] });
      queryClient.invalidateQueries({ queryKey: ['swap', 'approvalStrategy'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
