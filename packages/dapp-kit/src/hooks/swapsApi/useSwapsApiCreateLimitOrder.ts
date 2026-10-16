import type { CreateLimitOrderParamsV2, CreateLimitOrderResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/**
 * Mutation variables for {@link useSwapsApiCreateLimitOrder}. The per-request `apiConfig` override
 * belongs here rather than at the hook level.
 */
export type UseSwapsApiCreateLimitOrderVars = {
  body: CreateLimitOrderParamsV2;
  apiConfig?: RequestOverrideConfig;
};

/**
 * React hook to build an unsigned create-limit-order-intent transaction via the swaps API —
 * `sodax.api.swaps.createLimitOrderIntent` (same as create-intent but `deadline` is optional).
 * Returns `{ tx, intent, relayData }`; it does not change state, so no queries are invalidated.
 *
 * @example
 * const { mutateAsync: createLimitOrder } = useSwapsApiCreateLimitOrder();
 * const { tx, intent, relayData } = await createLimitOrder({ body: createLimitOrderParams });
 */
export const useSwapsApiCreateLimitOrder = ({
  mutationOptions,
}: MutationHookParams<CreateLimitOrderResponseV2, UseSwapsApiCreateLimitOrderVars> = {}): SafeUseMutationResult<
  CreateLimitOrderResponseV2,
  Error,
  UseSwapsApiCreateLimitOrderVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<CreateLimitOrderResponseV2, Error, UseSwapsApiCreateLimitOrderVars>({
    mutationKey: ['swapsApi', 'createLimitOrder'],
    retry: retryUnlessAuthFailure,
    ...mutationOptions,
    mutationFn: async ({ body, apiConfig }): Promise<CreateLimitOrderResponseV2> =>
      unwrapResult(await sodax.api.swaps.createLimitOrderIntent(body, apiConfig)),
  });
};
