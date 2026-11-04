import type { CreateIntentParamsV2, CreateIntentResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/**
 * Mutation variables for {@link useSwapsApiCreateIntent}. The per-request `apiConfig` override
 * belongs here rather than at the hook level.
 */
export type UseSwapsApiCreateIntentVars = {
  body: CreateIntentParamsV2;
  apiConfig?: RequestOverrideConfig;
};

/**
 * React hook to build an unsigned create-intent transaction via the swaps API —
 * `sodax.api.swaps.createIntent`. Returns `{ tx, intent, relayData }` to sign and broadcast
 * yourself; it does not change state, so no queries are invalidated.
 *
 * @example
 * const { mutateAsync: createIntent } = useSwapsApiCreateIntent();
 * const { tx, intent, relayData } = await createIntent({ body: createIntentParams });
 */
export const useSwapsApiCreateIntent = ({
  mutationOptions,
}: MutationHookParams<CreateIntentResponseV2, UseSwapsApiCreateIntentVars> = {}): SafeUseMutationResult<
  CreateIntentResponseV2,
  Error,
  UseSwapsApiCreateIntentVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<CreateIntentResponseV2, Error, UseSwapsApiCreateIntentVars>({
    mutationKey: ['swapsApi', 'createIntent'],
    retry: retryUnlessAuthFailure,
    ...mutationOptions,
    mutationFn: async ({ body, apiConfig }): Promise<CreateIntentResponseV2> =>
      unwrapResult(await sodax.api.swaps.createIntent(body, apiConfig)),
  });
};
