import { useQueryClient } from '@tanstack/react-query';
import type { BridgeWithApprovalParams, BridgeWithApprovalResponse, SpokeChainKey } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useBridgeWithApproval}: `useBridge`'s, plus `allowAccountUpgrade`, `resumeBatchId` and
 * `resumeBatchCallCount`.
 */
export type UseBridgeWithApprovalVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  BridgeWithApprovalParams<K>,
  'raw'
>;

/**
 * `useBridge` with the source-token approval folded in (`sodax.bridge.bridgeWithApproval`): no approval
 * when the allowance suffices, approve + deposit as one EIP-5792 batch (one signature) on a
 * batch-capable EVM wallet, otherwise approve, wait for it, then bridge. `data.approvalStrategy`
 * says which ran; {@link useBridgeApprovalStrategy} predicts it.
 *
 * Throws on SDK failure so React Query's error model engages. On success invalidates balances and
 * the bridge allowance and approval-strategy queries.
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
    mutationFn: async vars => unwrapResult(await sodax.bridge.bridgeWithApproval({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      invalidateBalances(queryClient, vars.params.srcChainKey, vars.params.dstChainKey);
      queryClient.invalidateQueries({ queryKey: ['bridge', 'allowance'] });
      queryClient.invalidateQueries({ queryKey: ['bridge', 'approvalStrategy'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
