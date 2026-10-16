import type { CancelIntentRequestV2, CancelIntentResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/**
 * Mutation variables for {@link useLeverageYieldApiCancelIntent}. The per-request `apiConfig` override belongs here
 * rather than at the hook level — different calls in the same component can target different
 * endpoints without re-rendering.
 */
export type UseLeverageYieldApiCancelIntentVars = {
  body: CancelIntentRequestV2;
  apiConfig?: RequestOverrideConfig;
};

/**
 * React hook to build an unsigned cancel-intent transaction via the leverage-yield API — `sodax.api.leverageYield.cancelIntent`.
 */
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
