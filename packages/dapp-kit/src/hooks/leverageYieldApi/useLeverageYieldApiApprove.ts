import type { CreateDepositIntentParamsV2, ApproveResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/** Per-call `apiConfig` so calls in one component can target different endpoints. */
export type UseLeverageYieldApiApproveVars = {
  body: CreateDepositIntentParamsV2;
  apiConfig?: RequestOverrideConfig;
};

/**
 * Returns the unsigned `{ tx, resetTx? }`; the reset must be mined before the approve.
 * Prefer {@link useLeverageYieldApiApproveAndBroadcast}, which owns that ordering.
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
