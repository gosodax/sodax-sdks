import type { RequestOverrideConfig, SubmitTxRequestV2, SubmitTxResponseV2 } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

export type UseSwapsApiSubmitTxVars = {
  request: SubmitTxRequestV2;
  apiConfig?: RequestOverrideConfig;
};

export const useSwapsApiSubmitTx = ({
  mutationOptions,
}: MutationHookParams<SubmitTxResponseV2, UseSwapsApiSubmitTxVars> = {}): SafeUseMutationResult<
  SubmitTxResponseV2,
  Error,
  UseSwapsApiSubmitTxVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<SubmitTxResponseV2, Error, UseSwapsApiSubmitTxVars>({
    mutationKey: ['swapsApi', 'submitTx'],
    retry: retryUnlessAuthFailure,
    ...mutationOptions,
    mutationFn: async ({ request, apiConfig }): Promise<SubmitTxResponseV2> =>
      unwrapResult(await sodax.api.swaps.submitTx(request, apiConfig)),
  });
};
