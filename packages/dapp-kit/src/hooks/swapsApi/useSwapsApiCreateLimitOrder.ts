import type { CreateLimitOrderParamsV2, CreateLimitOrderResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

export type UseSwapsApiCreateLimitOrderVars = {
  body: CreateLimitOrderParamsV2;
  apiConfig?: RequestOverrideConfig;
};

/** Same as create-intent, but `deadline` is optional. */
export const useSwapsApiCreateLimitOrder = ({
  mutationOptions,
}: MutationHookParams<CreateLimitOrderResponseV2, UseSwapsApiCreateLimitOrderVars> = {}): SafeUseMutationResult<
  CreateLimitOrderResponseV2,
  Error,
  UseSwapsApiCreateLimitOrderVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<CreateLimitOrderResponseV2, Error, UseSwapsApiCreateLimitOrderVars>({
    mutationKey: ['swapsApi', 'createLimitOrder'],
    retry: retryUnlessAuthFailure,
    ...mutationOptions,
    mutationFn: async ({ body, apiConfig }): Promise<CreateLimitOrderResponseV2> =>
      unwrapResult(await sodax.api.swaps.createLimitOrderIntent(body, apiConfig)),
  });
};
