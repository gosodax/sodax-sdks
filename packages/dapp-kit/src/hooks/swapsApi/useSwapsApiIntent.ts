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

/**
 * React hook to look up an Intent struct by its hub-chain creation tx hash via the swaps API —
 * `sodax.api.swaps.getIntent`. The decoded intent's bigint fields are returned as decimal strings.
 *
 * @example
 * const { data: intent } = useSwapsApiIntent({ params: { txHash: '0x123...' } });
 */
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
