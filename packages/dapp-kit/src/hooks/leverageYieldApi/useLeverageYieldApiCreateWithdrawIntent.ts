import type { CreateWithdrawIntentParamsV2, CreateIntentResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/**
 * Mutation variables for {@link useLeverageYieldApiCreateWithdrawIntent}. The per-request `apiConfig` override belongs here
 * rather than at the hook level — different calls in the same component can target different
 * endpoints without re-rendering.
 */
export type UseLeverageYieldApiCreateWithdrawIntentVars = {
  body: CreateWithdrawIntentParamsV2;
  apiConfig?: RequestOverrideConfig;
};

/**
 * React hook to build an unsigned withdraw create-intent transaction (lsoda* shares → any token) via the leverage-yield API — `sodax.api.leverageYield.createWithdrawIntent`.
 */
export const useLeverageYieldApiCreateWithdrawIntent = ({
  mutationOptions,
}: MutationHookParams<CreateIntentResponseV2, UseLeverageYieldApiCreateWithdrawIntentVars> = {}): SafeUseMutationResult<
  CreateIntentResponseV2,
  Error,
  UseLeverageYieldApiCreateWithdrawIntentVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<CreateIntentResponseV2, Error, UseLeverageYieldApiCreateWithdrawIntentVars>({
    mutationKey: ['leverageYieldApi', 'createWithdrawIntent'],
    retry: retryUnlessAuthFailure,
    ...mutationOptions,
    mutationFn: async ({ body, apiConfig }): Promise<CreateIntentResponseV2> =>
      unwrapResult(await sodax.api.leverageYield.createWithdrawIntent(body, apiConfig)),
  });
};
