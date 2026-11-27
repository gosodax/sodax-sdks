import { useQueryClient } from '@tanstack/react-query';
import type { BridgeWithApprovalParams, BridgeWithApprovalResponse, SpokeChainKey } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { retryBeforeSubmission } from '../shared/retryBeforeSubmission.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseBridgeWithApprovalVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  BridgeWithApprovalParams<K>,
  'raw'
>;

/**
 * `useBridge` with approval folded in (one EIP-5792 batch where supported); `data.approvalStrategy` says which path ran.
 * Throws on SDK failure; on success invalidates balances, allowance and approval-strategy queries.
 */
export function useBridgeWithApproval<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<BridgeWithApprovalResponse, UseBridgeWithApprovalVars<K>> = {}): SafeUseMutationResult<
  BridgeWithApprovalResponse,
  Error,
  UseBridgeWithApprovalVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<BridgeWithApprovalResponse, Error, UseBridgeWithApprovalVars<K>>({
    mutationKey: ['bridge', 'bridgeWithApproval'],
    ...mutationOptions,
    retry: retryBeforeSubmission(
      mutationOptions?.retry ??
        queryClient.getMutationDefaults?.(mutationOptions?.mutationKey ?? ['bridge', 'bridgeWithApproval'])?.retry ??
        queryClient.getDefaultOptions?.().mutations?.retry,
    ),
    mutationFn: async vars => unwrapResult(await sodax.bridge.bridgeWithApproval({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      invalidateBalances(queryClient, vars.params.srcChainKey, vars.params.dstChainKey);
      queryClient.invalidateQueries({ queryKey: ['bridge', 'allowance'] });
      queryClient.invalidateQueries({ queryKey: ['bridge', 'approvalStrategy'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
