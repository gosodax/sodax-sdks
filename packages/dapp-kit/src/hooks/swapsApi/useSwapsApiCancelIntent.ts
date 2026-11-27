import type { CancelIntentRequestV2, CancelIntentResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

export type UseSwapsApiCancelIntentVars = {
  body: CancelIntentRequestV2;
  apiConfig?: RequestOverrideConfig;
};

export const useSwapsApiCancelIntent = ({
  mutationOptions,
}: MutationHookParams<CancelIntentResponseV2, UseSwapsApiCancelIntentVars> = {}): SafeUseMutationResult<
  CancelIntentResponseV2,
  Error,
  UseSwapsApiCancelIntentVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<CancelIntentResponseV2, Error, UseSwapsApiCancelIntentVars>({
    mutationKey: ['swapsApi', 'cancelIntent'],
    retry: retryUnlessAuthFailure,
    ...mutationOptions,
    mutationFn: async ({ body, apiConfig }): Promise<CancelIntentResponseV2> =>
      unwrapResult(await sodax.api.swaps.cancelIntent(body, apiConfig)),
  });
};
