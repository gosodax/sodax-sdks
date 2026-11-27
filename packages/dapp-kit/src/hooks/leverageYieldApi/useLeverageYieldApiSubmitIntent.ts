import type { SubmitIntentRequestV2, SubmitIntentResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/** Per-call `apiConfig` so calls in one component can target different endpoints. */
export type UseLeverageYieldApiSubmitIntentVars = {
  body: SubmitIntentRequestV2;
  apiConfig?: RequestOverrideConfig;
};

/** Submits the already-broadcast intent tx to the relay. */
export const useLeverageYieldApiSubmitIntent = ({
  mutationOptions,
}: MutationHookParams<SubmitIntentResponseV2, UseLeverageYieldApiSubmitIntentVars> = {}): SafeUseMutationResult<
  SubmitIntentResponseV2,
  Error,
  UseLeverageYieldApiSubmitIntentVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<SubmitIntentResponseV2, Error, UseLeverageYieldApiSubmitIntentVars>({
    mutationKey: ['leverageYieldApi', 'submitIntent'],
    retry: false,
    ...mutationOptions,
    mutationFn: async ({ body, apiConfig }): Promise<SubmitIntentResponseV2> =>
      unwrapResult(await sodax.api.leverageYield.submitIntent(body, apiConfig)),
  });
};
