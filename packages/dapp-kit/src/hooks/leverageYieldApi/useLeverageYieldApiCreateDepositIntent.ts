import type { CreateDepositIntentParamsV2, CreateIntentResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/** Per-call `apiConfig` so calls in one component can target different endpoints. */
export type UseLeverageYieldApiCreateDepositIntentVars = {
  body: CreateDepositIntentParamsV2;
  apiConfig?: RequestOverrideConfig;
};

/** Builds an unsigned deposit create-intent tx (any token → lsoda* shares). */
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
