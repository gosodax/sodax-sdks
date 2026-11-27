import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IntentStateV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseSwapsApiFilledIntentParams = ReadHookParams<
  IntentStateV2 | undefined,
  {
    txHash: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

export const useSwapsApiFilledIntent = ({
  params,
  queryOptions,
}: UseSwapsApiFilledIntentParams = {}): UseQueryResult<IntentStateV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const txHash = params?.txHash;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['swapsApi', 'filledIntent', txHash],
    queryFn: async (): Promise<IntentStateV2 | undefined> => {
      if (!txHash) return undefined;
      return unwrapResult(await sodax.api.swaps.getFilledIntent(txHash, apiConfig));
    },
    enabled: !!txHash && txHash.length > 0,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
