import type { ApproveResponseV2, CreateIntentParamsV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

export type UseSwapsApiApproveVars = {
  body: CreateIntentParamsV2;
  apiConfig?: RequestOverrideConfig;
};

/** Builds the unsigned approval tx(s) only; {@link useSwapsApiApproveAndBroadcast} also signs, orders and waits. */
export const useSwapsApiApprove = ({
  mutationOptions,
}: MutationHookParams<ApproveResponseV2, UseSwapsApiApproveVars> = {}): SafeUseMutationResult<
  ApproveResponseV2,
  Error,
  UseSwapsApiApproveVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<ApproveResponseV2, Error, UseSwapsApiApproveVars>({
    mutationKey: ['swapsApi', 'approve'],
    retry: retryUnlessAuthFailure,
    ...mutationOptions,
    mutationFn: async ({ body, apiConfig }): Promise<ApproveResponseV2> =>
      unwrapResult(await sodax.api.swaps.approve(body, apiConfig)),
  });
};
