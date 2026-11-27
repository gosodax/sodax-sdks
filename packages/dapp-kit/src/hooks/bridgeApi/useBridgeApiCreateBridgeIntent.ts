import type { CreateBridgeIntentParamsV2, CreateBridgeIntentResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

export type UseBridgeApiCreateBridgeIntentVars = {
  body: CreateBridgeIntentParamsV2;
  apiConfig?: RequestOverrideConfig;
};

/** Returns the unsigned spoke-deposit `{ tx, relayData }` to sign and broadcast yourself; invalidates no queries. */
export const useBridgeApiCreateBridgeIntent = ({
  mutationOptions,
}: MutationHookParams<CreateBridgeIntentResponseV2, UseBridgeApiCreateBridgeIntentVars> = {}): SafeUseMutationResult<
  CreateBridgeIntentResponseV2,
  Error,
  UseBridgeApiCreateBridgeIntentVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<CreateBridgeIntentResponseV2, Error, UseBridgeApiCreateBridgeIntentVars>({
    mutationKey: ['bridgeApi', 'createBridgeIntent'],
    retry: retryUnlessAuthFailure,
    ...mutationOptions,
    mutationFn: async ({ body, apiConfig }): Promise<CreateBridgeIntentResponseV2> =>
      unwrapResult(await sodax.api.bridge.createBridgeIntent(body, apiConfig)),
  });
};
