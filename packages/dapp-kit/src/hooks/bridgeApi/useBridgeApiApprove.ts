import type { BridgeApproveResponseV2, CreateBridgeIntentParamsV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/**
 * Mutation variables for {@link useBridgeApiApprove}. The per-request `apiConfig` override belongs
 * here rather than at the hook level — different calls in the same component can target different
 * endpoints without re-rendering.
 */
export type UseBridgeApiApproveVars = {
  body: CreateBridgeIntentParamsV2;
  apiConfig?: RequestOverrideConfig;
};

/**
 * React hook to build the unsigned token-approval transaction(s) for the source token via the bridge
 * API — `sodax.api.bridge.approve`. Returns `{ tx, resetTx? }` (chain-specific unsigned txs) to sign
 * and broadcast yourself; it does not change state, so no queries are invalidated.
 *
 * `resetTx`, when present, must be MINED before `tx` is a valid state transition. Prefer
 * {@link useBridgeApiApproveAndBroadcast}, which owns that ordering and invalidates the allowance query.
 *
 * @example
 * const { mutateAsync: approve } = useBridgeApiApprove();
 * const { tx, resetTx } = await approve({ body: createBridgeIntentParams });
 */
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
