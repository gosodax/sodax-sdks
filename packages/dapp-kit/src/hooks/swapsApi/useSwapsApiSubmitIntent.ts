import type { RequestOverrideConfig, SubmitIntentRequestV2, SubmitIntentResponseV2 } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

export type UseSwapsApiSubmitIntentVars = {
  body: SubmitIntentRequestV2;
  apiConfig?: RequestOverrideConfig;
};

/** No auto-retry: submit is non-idempotent, so a retry after a lost response could double-submit. */
export const useSwapsApiSubmitIntent = ({
  mutationOptions,
}: MutationHookParams<SubmitIntentResponseV2, UseSwapsApiSubmitIntentVars> = {}): SafeUseMutationResult<
  SubmitIntentResponseV2,
  Error,
  UseSwapsApiSubmitIntentVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<SubmitIntentResponseV2, Error, UseSwapsApiSubmitIntentVars>({
    mutationKey: ['swapsApi', 'submitIntent'],
    retry: false,
    ...mutationOptions,
    mutationFn: async ({ body, apiConfig }): Promise<SubmitIntentResponseV2> =>
      unwrapResult(await sodax.api.swaps.submitIntent(body, apiConfig)),
  });
};
