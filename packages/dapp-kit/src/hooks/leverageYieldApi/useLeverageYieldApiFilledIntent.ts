import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IntentStateV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiFilledIntentParams = ReadHookParams<
  IntentStateV2 | undefined,
  {
    txHash: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to get the on-chain fill state for an intent by its hub-chain tx hash via the leverage-yield API — `sodax.api.leverageYield.getFilledIntent`.
 *
 * @example
 * const { data } = useLeverageYieldApiFilledIntent({ params: { txHash: '0x123...' } });
 */
export const useLeverageYieldApiFilledIntent = ({
  params,
  queryOptions,
}: UseLeverageYieldApiFilledIntentParams = {}): UseQueryResult<IntentStateV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const txHash = params?.txHash;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'filledIntent', txHash],
    queryFn: async (): Promise<IntentStateV2 | undefined> => {
      if (!txHash) return undefined;
      return unwrapResult(await sodax.api.leverageYield.getFilledIntent(txHash, apiConfig));
    },
    enabled: !!txHash && txHash.length > 0,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
