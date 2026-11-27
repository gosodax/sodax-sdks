import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { GetIntentResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseSwapsApiIntentParams = ReadHookParams<
  GetIntentResponseV2 | undefined,
  {
    txHash: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/** Bigint fields of the decoded intent come back as decimal strings. */
export const useSwapsApiIntent = ({
  params,
  queryOptions,
}: UseSwapsApiIntentParams = {}): UseQueryResult<GetIntentResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const txHash = params?.txHash;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['swapsApi', 'intent', txHash],
    queryFn: async (): Promise<GetIntentResponseV2 | undefined> => {
      if (!txHash) return undefined;
      return unwrapResult(await sodax.api.swaps.getIntent(txHash, apiConfig));
    },
    enabled: !!txHash && txHash.length > 0,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
