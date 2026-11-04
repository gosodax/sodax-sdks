import type { SubmitIntentRequestV2, SubmitIntentResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/**
 * Mutation variables for {@link useLeverageYieldApiSubmitIntent}. The per-request `apiConfig` override belongs here
 * rather than at the hook level — different calls in the same component can target different
 * endpoints without re-rendering.
 */
export type UseLeverageYieldApiSubmitIntentVars = {
  body: SubmitIntentRequestV2;
  apiConfig?: RequestOverrideConfig;
};

/**
 * React hook to submit the broadcast intent tx to the relay via the leverage-yield API — `sodax.api.leverageYield.submitIntent`.
 */
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
