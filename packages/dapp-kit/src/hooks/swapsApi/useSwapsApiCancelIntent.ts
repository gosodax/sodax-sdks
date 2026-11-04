import type { CancelIntentRequestV2, CancelIntentResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/**
 * Mutation variables for {@link useSwapsApiCancelIntent}. The per-request `apiConfig` override
 * belongs here rather than at the hook level.
 */
export type UseSwapsApiCancelIntentVars = {
  body: CancelIntentRequestV2;
  apiConfig?: RequestOverrideConfig;
};

/**
 * React hook to build an unsigned cancel-intent transaction via the swaps API —
 * `sodax.api.swaps.cancelIntent`. The `intent` carries `bigint` numerics. Returns `{ tx }` to sign
 * and broadcast yourself; it does not change state, so no queries are invalidated.
 *
 * @example
 * const { mutateAsync: cancelIntent } = useSwapsApiCancelIntent();
 * const { tx } = await cancelIntent({ body: { srcChainKey: 'sonic', intent } });
 */
export const useSwapsApiCancelIntent = ({
  mutationOptions,
}: MutationHookParams<CancelIntentResponseV2, UseSwapsApiCancelIntentVars> = {}): SafeUseMutationResult<
  CancelIntentResponseV2,
  Error,
  UseSwapsApiCancelIntentVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<CancelIntentResponseV2, Error, UseSwapsApiCancelIntentVars>({
    mutationKey: ['swapsApi', 'cancelIntent'],
    retry: retryUnlessAuthFailure,
    ...mutationOptions,
    mutationFn: async ({ body, apiConfig }): Promise<CancelIntentResponseV2> =>
      unwrapResult(await sodax.api.swaps.cancelIntent(body, apiConfig)),
  });
};
