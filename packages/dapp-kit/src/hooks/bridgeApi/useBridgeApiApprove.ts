import type { BridgeApproveResponseV2, CreateBridgeIntentParamsV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

export type UseBridgeApiApproveVars = {
  body: CreateBridgeIntentParamsV2;
  apiConfig?: RequestOverrideConfig;
};

/** Returns unsigned `{ tx, resetTx? }`; `resetTx` must be MINED before `tx` is valid.
 * Prefer {@link useBridgeApiApproveAndBroadcast}, which owns that ordering. */
export const useBridgeApiApprove = ({
  mutationOptions,
}: MutationHookParams<BridgeApproveResponseV2, UseBridgeApiApproveVars> = {}): SafeUseMutationResult<
  BridgeApproveResponseV2,
  Error,
  UseBridgeApiApproveVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<BridgeApproveResponseV2, Error, UseBridgeApiApproveVars>({
    mutationKey: ['bridgeApi', 'approve'],
    retry: retryUnlessAuthFailure,
    ...mutationOptions,
    mutationFn: async ({ body, apiConfig }): Promise<BridgeApproveResponseV2> =>
      unwrapResult(await sodax.api.bridge.approve(body, apiConfig)),
  });
};
