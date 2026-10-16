import type { CreateBridgeIntentParamsV2, CreateBridgeIntentResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/**
 * Mutation variables for {@link useBridgeApiCreateBridgeIntent}. The per-request `apiConfig`
 * override belongs here rather than at the hook level.
 */
export type UseBridgeApiCreateBridgeIntentVars = {
  body: CreateBridgeIntentParamsV2;
  apiConfig?: RequestOverrideConfig;
};

/**
 * React hook to build an unsigned spoke-deposit (create-bridge-intent) transaction via the bridge
 * API — `sodax.api.bridge.createBridgeIntent`. Returns `{ tx, relayData }` (no `intent` struct —
 * bridge is vault-backed) to sign and broadcast yourself; it does not change state, so no queries
 * are invalidated.
 *
 * @example
 * const { mutateAsync: createBridgeIntent } = useBridgeApiCreateBridgeIntent();
 * const { tx, relayData } = await createBridgeIntent({ body: createBridgeIntentParams });
 */
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
