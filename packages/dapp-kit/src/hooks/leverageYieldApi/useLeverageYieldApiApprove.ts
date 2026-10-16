import type { CreateDepositIntentParamsV2, ApproveResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/**
 * Mutation variables for {@link useLeverageYieldApiApprove}. The per-request `apiConfig` override belongs here
 * rather than at the hook level — different calls in the same component can target different
 * endpoints without re-rendering.
 */
export type UseLeverageYieldApiApproveVars = {
  body: CreateDepositIntentParamsV2;
  apiConfig?: RequestOverrideConfig;
};

/**
 * React hook to build an unsigned token-approval transaction for the deposit input token via the leverage-yield API — `sodax.api.leverageYield.approve`.
 */
export const useLeverageYieldApiApprove = ({
  mutationOptions,
}: MutationHookParams<ApproveResponseV2, UseLeverageYieldApiApproveVars> = {}): SafeUseMutationResult<
  ApproveResponseV2,
  Error,
  UseLeverageYieldApiApproveVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<ApproveResponseV2, Error, UseLeverageYieldApiApproveVars>({
    mutationKey: ['leverageYieldApi', 'approve'],
    retry: retryUnlessAuthFailure,
    ...mutationOptions,
    mutationFn: async ({ body, apiConfig }): Promise<ApproveResponseV2> =>
      unwrapResult(await sodax.api.leverageYield.approve(body, apiConfig)),
  });
};
