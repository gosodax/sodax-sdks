import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { SolverExecutionRequest, SolverExecutionResponse } from '@sodax/sdk';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseLeverageYieldNotifySolverVars = SolverExecutionRequest;

/** Manual-relay notify step with the hub-side intent tx hash; {@link useLeverageYieldVaultSwap} already does this. */
export function useLeverageYieldNotifySolver({
  mutationOptions,
}: MutationHookParams<SolverExecutionResponse, UseLeverageYieldNotifySolverVars> = {}): SafeUseMutationResult<
  SolverExecutionResponse,
  Error,
  UseLeverageYieldNotifySolverVars
> {
  const { sodax } = useSodaxContext();

  return useSafeMutation<SolverExecutionResponse, Error, UseLeverageYieldNotifySolverVars>({
    mutationKey: ['leverageYield', 'notifySolver'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.leverageYield.notifySolver(vars)),
  });
}
