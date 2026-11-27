import type { CancelIntentRequestV2, CancelIntentResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/** Per-call `apiConfig` so calls in one component can target different endpoints. */
export type UseLeverageYieldApiCancelIntentVars = {
  body: CancelIntentRequestV2;
  apiConfig?: RequestOverrideConfig;
};

/** Builds an unsigned cancel-intent tx for the caller to sign and broadcast. */
export const useLeverageYieldApiCancelIntent = ({
  mutationOptions,
}: MutationHookParams<CancelIntentResponseV2, UseLeverageYieldApiCancelIntentVars> = {}): SafeUseMutationResult<
  CancelIntentResponseV2,
  Error,
  UseLeverageYieldApiCancelIntentVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<CancelIntentResponseV2, Error, UseLeverageYieldApiCancelIntentVars>({
    mutationKey: ['leverageYieldApi', 'cancelIntent'],
    retry: retryUnlessAuthFailure,
    ...mutationOptions,
    mutationFn: async ({ body, apiConfig }): Promise<CancelIntentResponseV2> =>
      unwrapResult(await sodax.api.leverageYield.cancelIntent(body, apiConfig)),
  });
};
