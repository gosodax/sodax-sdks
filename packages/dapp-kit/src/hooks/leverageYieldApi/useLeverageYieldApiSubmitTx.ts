import type { LeverageYieldSubmitTxRequestV2, SubmitTxResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/** Per-call `apiConfig` so calls in one component can target different endpoints. */
export type UseLeverageYieldApiSubmitTxVars = {
  request: LeverageYieldSubmitTxRequestV2;
  apiConfig?: RequestOverrideConfig;
};

/** Submits a vault-swap tx for backend processing (relay, post-execution). */
export const useLeverageYieldApiSubmitTx = ({
  mutationOptions,
}: MutationHookParams<SubmitTxResponseV2, UseLeverageYieldApiSubmitTxVars> = {}): SafeUseMutationResult<
  SubmitTxResponseV2,
  Error,
  UseLeverageYieldApiSubmitTxVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<SubmitTxResponseV2, Error, UseLeverageYieldApiSubmitTxVars>({
    mutationKey: ['leverageYieldApi', 'submitTx'],
    retry: retryUnlessAuthFailure,
    ...mutationOptions,
    mutationFn: async ({ request, apiConfig }): Promise<SubmitTxResponseV2> =>
      unwrapResult(await sodax.api.leverageYield.submitTx(request, apiConfig)),
  });
};
