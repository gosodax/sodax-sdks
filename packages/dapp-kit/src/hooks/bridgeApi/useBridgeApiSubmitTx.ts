import type { BridgeSubmitTxRequestV2, BridgeSubmitTxResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/**
 * Mutation variables for {@link useBridgeApiSubmitTx}. The per-request `apiConfig` override
 * (e.g. base URL) belongs here rather than at the hook level — different submissions in the same
 * component can target different endpoints without re-rendering.
 */
export type UseBridgeApiSubmitTxVars = {
  request: BridgeSubmitTxRequestV2;
  apiConfig?: RequestOverrideConfig;
};

/**
 * React hook for submitting a broadcast bridge (spoke-deposit) transaction to be processed
 * (relayed server-side) via the bridge API — `sodax.api.bridge.submitTx`. Called AFTER signing +
 * broadcasting the spoke-deposit tx, handing it (with the FULL `relayData { address, payload }`
 * envelope) to the backend.
 *
 * Pure mutation: pass `{ request, apiConfig? }` to `mutate({...})`. Retries up to 3 times at the
 * hook level, except on a terminal API-key rejection (401/403) — see `retryUnlessAuthFailure`.
 * Consumers can override via `mutationOptions.retry`.
 *
 * @example
 * const { mutateAsync: submitBridgeTx, isPending, error } = useBridgeApiSubmitTx();
 *
 * const result = await submitBridgeTx({
 *   request: { txHash: '0x123...', srcChainKey: '0xa4b1.arbitrum', walletAddress: '0xabc...', relayData: { address: '0x...', payload: '0x...' } },
 *   apiConfig: { baseURL: 'https://...' },
 * });
 */
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
