import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { GetSwapTokensResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseSwapsApiTokensParams = ReadHookParams<
  GetSwapTokensResponseV2,
  {
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to fetch all supported swap tokens grouped by SpokeChainKey via the swaps API —
 * `sodax.api.swaps.getTokens`.
 *
 * @example
 * const { data: tokensByChain } = useSwapsApiTokens();
 */
export const useSwapsApiTokens = ({
  params,
  queryOptions,
}: UseSwapsApiTokensParams = {}): UseQueryResult<GetSwapTokensResponseV2, Error> => {
  const { sodax } = useSodaxContext();
  const apiConfig = params?.apiConfig;

  return useQuery<GetSwapTokensResponseV2, Error>({
    queryKey: ['swapsApi', 'tokens'],
    queryFn: async (): Promise<GetSwapTokensResponseV2> => unwrapResult(await sodax.api.swaps.getTokens(apiConfig)),
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
