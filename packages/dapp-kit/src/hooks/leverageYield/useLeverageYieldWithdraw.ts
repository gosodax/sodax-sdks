import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { LeverageYieldSwapPayload, LeverageYieldSwapWithdrawParams } from '@sodax/sdk';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseLeverageYieldWithdrawVars = LeverageYieldSwapWithdrawParams;

/** Builds (does not execute) a withdraw payload with `hubWalletSwap: true`; spread it into {@link useLeverageYieldVaultSwap}. */
export function useLeverageYieldWithdraw({
  mutationOptions,
}: MutationHookParams<LeverageYieldSwapPayload, UseLeverageYieldWithdrawVars> = {}): SafeUseMutationResult<
  LeverageYieldSwapPayload,
  Error,
  UseLeverageYieldWithdrawVars
> {
  const { sodax } = useSodaxContext();

  return useSafeMutation<LeverageYieldSwapPayload, Error, UseLeverageYieldWithdrawVars>({
    mutationKey: ['leverageYield', 'withdraw'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.leverageYield.withdraw(vars)),
  });
}
