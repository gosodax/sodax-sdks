import { ChainKeys, type ActivateStellarAccountParams, type ActivateStellarAccountResult } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/** Keep mutation variables aligned with the SDK operation. */
export type UseActivateStellarAccountVars = ActivateStellarAccountParams;

/**
 * Activate a Stellar account through the sponsoring service. Both `submitted`
 * and `alreadyActive` are successful outcomes.
 */
export function useActivateStellarAccount({
  mutationOptions,
}: MutationHookParams<ActivateStellarAccountResult, UseActivateStellarAccountVars> = {}): SafeUseMutationResult<
  ActivateStellarAccountResult,
  Error,
  UseActivateStellarAccountVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<ActivateStellarAccountResult, Error, UseActivateStellarAccountVars>({
    mutationKey: ['sponsoring', 'activateStellarAccount'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.sponsoring.activateStellarAccount(vars)),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['sponsoring', 'stellarAccountActive', vars.address] });
      queryClient.invalidateQueries({ queryKey: ['sponsoring', 'stellarAccountStatus', vars.address] });
      // Clear trustline errors cached while the account did not exist.
      queryClient.invalidateQueries({ queryKey: ['shared', 'stellarTrustlineCheck'] });
      invalidateBalances(queryClient, ChainKeys.STELLAR_MAINNET);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
