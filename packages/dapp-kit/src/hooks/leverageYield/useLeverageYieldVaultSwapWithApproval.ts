import { useQueryClient } from '@tanstack/react-query';
import type { SpokeChainKey, VaultSwapWithApprovalParams, VaultSwapWithApprovalResponse } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseLeverageYieldVaultSwapWithApprovalVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  VaultSwapWithApprovalParams<K>,
  'raw'
>;

/**
 * `useLeverageYieldVaultSwap` with the deposit approval folded in (EIP-5792 batch when supported, else sequential).
 * `data.approvalStrategy` says which path ran; {@link useLeverageYieldApprovalStrategy} predicts it.
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
