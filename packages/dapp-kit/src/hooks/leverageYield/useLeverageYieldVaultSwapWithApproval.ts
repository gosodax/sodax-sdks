import { useQueryClient } from '@tanstack/react-query';
import type { SpokeChainKey, VaultSwapWithApprovalParams, VaultSwapWithApprovalResponse } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useLeverageYieldVaultSwapWithApproval}: `useLeverageYieldVaultSwap`'s, plus
 * `allowAccountUpgrade`, `resumeBatchId` and `resumeBatchCallCount`.
 */
export type UseLeverageYieldVaultSwapWithApprovalVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  VaultSwapWithApprovalParams<K>,
  'raw'
>;

/**
 * `useLeverageYieldVaultSwap` with the deposit's source-token approval folded in
 * (`sodax.leverageYield.vaultSwapWithApproval`): approve + deposit as one EIP-5792 batch (one
 * signature) on a batch-capable EVM wallet, otherwise approve, wait for it, then deposit. A withdraw
 * (`hubWalletSwap`) needs no approval and runs as `useLeverageYieldVaultSwap` does.
 * `data.approvalStrategy` says which path ran; {@link useLeverageYieldApprovalStrategy} predicts it.
 *
 * Throws on SDK failure so React Query's error model engages. On success invalidates balances, the
 * deposit allowance (read through `useSwapAllowance`) and the approval-strategy query.
 */
export function useLeverageYieldVaultSwapWithApproval<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<
  VaultSwapWithApprovalResponse,
  UseLeverageYieldVaultSwapWithApprovalVars<K>
> = {}): SafeUseMutationResult<VaultSwapWithApprovalResponse, Error, UseLeverageYieldVaultSwapWithApprovalVars<K>> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<VaultSwapWithApprovalResponse, Error, UseLeverageYieldVaultSwapWithApprovalVars<K>>({
    mutationKey: ['leverageYield', 'vaultSwapWithApproval'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.leverageYield.vaultSwapWithApproval({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      invalidateBalances(queryClient, vars.params.srcChainKey, vars.params.dstChainKey);
      queryClient.invalidateQueries({ queryKey: ['swap', 'allowance'] });
      queryClient.invalidateQueries({ queryKey: ['leverageYield', 'approvalStrategy'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
