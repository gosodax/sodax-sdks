import type { CreateDepositIntentParamsV2, CreateIntentResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/**
 * Mutation variables for {@link useLeverageYieldApiCreateDepositIntent}. The per-request `apiConfig` override belongs here
 * rather than at the hook level — different calls in the same component can target different
 * endpoints without re-rendering.
 */
export type UseLeverageYieldApiCreateDepositIntentVars = {
  body: CreateDepositIntentParamsV2;
  apiConfig?: RequestOverrideConfig;
};

/**
 * React hook to build an unsigned deposit create-intent transaction (any token → lsoda* shares) via the leverage-yield API — `sodax.api.leverageYield.createDepositIntent`.
 */
export const useLeverageYieldApiCreateDepositIntent = ({
  mutationOptions,
}: MutationHookParams<CreateIntentResponseV2, UseLeverageYieldApiCreateDepositIntentVars> = {}): SafeUseMutationResult<
  CreateIntentResponseV2,
  Error,
  UseLeverageYieldApiCreateDepositIntentVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<CreateIntentResponseV2, Error, UseLeverageYieldApiCreateDepositIntentVars>({
    mutationKey: ['leverageYieldApi', 'createDepositIntent'],
    retry: retryUnlessAuthFailure,
    ...mutationOptions,
    mutationFn: async ({ body, apiConfig }): Promise<CreateIntentResponseV2> =>
      unwrapResult(await sodax.api.leverageYield.createDepositIntent(body, apiConfig)),
  });
};
