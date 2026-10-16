import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IntentHashResponseV2, IntentRequestV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiIntentHashParams = ReadHookParams<
  IntentHashResponseV2 | undefined,
  {
    intent: IntentRequestV2 | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to compute the keccak256 hash of an Intent struct via the leverage-yield API —
 * `sodax.api.leverageYield.getIntentHash`. Returns `{ hash }`.
 *
 * @example
 * const { data } = useLeverageYieldApiIntentHash({ params: { intent } });
 */
export const useLeverageYieldApiIntentHash = ({
  params,
  queryOptions,
}: UseLeverageYieldApiIntentHashParams = {}): UseQueryResult<IntentHashResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const intent = params?.intent;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'intentHash', intent?.intentId?.toString()],
    queryFn: async (): Promise<IntentHashResponseV2 | undefined> => {
      if (!intent) return undefined;
      return unwrapResult(await sodax.api.leverageYield.getIntentHash({ intent }, apiConfig));
    },
    enabled: !!intent,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
