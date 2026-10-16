import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { GetSwapTokensByChainResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseSwapsApiTokensByChainParams = ReadHookParams<
  GetSwapTokensByChainResponseV2 | undefined,
  {
    chainKey: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to fetch supported swap tokens for a single SpokeChainKey via the swaps API —
 * `sodax.api.swaps.getTokensByChain`.
 *
 * @example
 * const { data: tokens } = useSwapsApiTokensByChain({ params: { chainKey: '0xa4b1.arbitrum' } });
 */
export const useSwapsApiTokensByChain = ({
  params,
  queryOptions,
}: UseSwapsApiTokensByChainParams = {}): UseQueryResult<GetSwapTokensByChainResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const chainKey = params?.chainKey;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['swapsApi', 'tokens', chainKey],
    queryFn: async (): Promise<GetSwapTokensByChainResponseV2 | undefined> => {
      if (!chainKey) return undefined;
      return unwrapResult(await sodax.api.swaps.getTokensByChain(chainKey, apiConfig));
    },
    enabled: !!chainKey && chainKey.length > 0,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
