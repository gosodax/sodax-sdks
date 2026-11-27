import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { SpokeChainKey, VaultSwapActionParams, VaultSwapResponse } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseLeverageYieldVaultSwapVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  VaultSwapActionParams<K, false>,
  'raw'
>;

/**
 * Executes a vault swap from a {@link useLeverageYieldDeposit} / {@link useLeverageYieldWithdraw} payload; transport
 * (backend submit with client fallback, or client-only) follows `sodax.config.leverageYieldUseBackendSubmitTx`.
 */
export function useLeverageYieldVaultSwap<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<VaultSwapResponse, UseLeverageYieldVaultSwapVars<K>> = {}): SafeUseMutationResult<
  VaultSwapResponse,
  Error,
  UseLeverageYieldVaultSwapVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<VaultSwapResponse, Error, UseLeverageYieldVaultSwapVars<K>>({
    mutationKey: ['leverageYield', 'vaultSwap'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.leverageYield.vaultSwap({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      invalidateBalances(queryClient, vars.params.srcChainKey, vars.params.dstChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
