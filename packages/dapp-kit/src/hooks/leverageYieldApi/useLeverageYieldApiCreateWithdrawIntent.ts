import type { CreateWithdrawIntentParamsV2, CreateIntentResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/** Per-call `apiConfig` so calls in one component can target different endpoints. */
export type UseLeverageYieldApiCreateWithdrawIntentVars = {
  body: CreateWithdrawIntentParamsV2;
  apiConfig?: RequestOverrideConfig;
};

/** Builds an unsigned withdraw create-intent tx (lsoda* shares → any token). */
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
