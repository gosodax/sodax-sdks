import type { BridgeSubmitTxRequestV2, BridgeSubmitTxResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

export type UseBridgeApiSubmitTxVars = {
  request: BridgeSubmitTxRequestV2;
  apiConfig?: RequestOverrideConfig;
};

/** Call after broadcasting the spoke-deposit tx, passing the FULL `relayData { address, payload }` envelope.
 * Retries up to 3 times except on API-key rejection (401/403). */
export const useBridgeApiSubmitTx = ({
  mutationOptions,
}: MutationHookParams<BridgeSubmitTxResponseV2, UseBridgeApiSubmitTxVars> = {}): SafeUseMutationResult<
  BridgeSubmitTxResponseV2,
  Error,
  UseBridgeApiSubmitTxVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<BridgeSubmitTxResponseV2, Error, UseBridgeApiSubmitTxVars>({
    mutationKey: ['bridgeApi', 'submitTx'],
    retry: retryUnlessAuthFailure,
    ...mutationOptions,
    mutationFn: async ({ request, apiConfig }): Promise<BridgeSubmitTxResponseV2> =>
      unwrapResult(await sodax.api.bridge.submitTx(request, apiConfig)),
  });
};
