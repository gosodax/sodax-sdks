import type { LeverageYieldSubmitTxRequestV2, SubmitTxResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/**
 * Mutation variables for {@link useLeverageYieldApiSubmitTx}. The per-request `apiConfig` override belongs here
 * rather than at the hook level — different calls in the same component can target different
 * endpoints without re-rendering.
 */
export type UseLeverageYieldApiSubmitTxVars = {
  request: LeverageYieldSubmitTxRequestV2;
  apiConfig?: RequestOverrideConfig;
};

/**
 * React hook to submit a vault-swap transaction to be processed (relay, post-execution, etc.) via the leverage-yield API — `sodax.api.leverageYield.submitTx`.
 */
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
