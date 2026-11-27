import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { LeverageYieldSwapPayload, LeverageYieldSwapDepositParams } from '@sodax/sdk';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseLeverageYieldDepositVars = LeverageYieldSwapDepositParams;

/** Builds (does not execute) a deposit payload; spread it into {@link useLeverageYieldVaultSwap}. */
export function useLeverageYieldDeposit({
  mutationOptions,
}: MutationHookParams<LeverageYieldSwapPayload, UseLeverageYieldDepositVars> = {}): SafeUseMutationResult<
  LeverageYieldSwapPayload,
  Error,
  UseLeverageYieldDepositVars
> {
  const { sodax } = useSodaxContext();

  return useSafeMutation<LeverageYieldSwapPayload, Error, UseLeverageYieldDepositVars>({
    mutationKey: ['leverageYield', 'deposit'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.leverageYield.deposit(vars)),
  });
}
