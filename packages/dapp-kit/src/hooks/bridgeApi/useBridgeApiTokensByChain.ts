import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { GetBridgeTokensByChainResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBridgeApiTokensByChainParams = ReadHookParams<
  GetBridgeTokensByChainResponseV2 | undefined,
  {
    chainKey: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to fetch supported bridge tokens for a single SpokeChainKey via the bridge API —
 * `sodax.api.bridge.getTokensByChain`. Use `useBridgeApiTokens` for every chain at once.
 *
 * @example
 * const { data: tokens } = useBridgeApiTokensByChain({ params: { chainKey: '0xa4b1.arbitrum' } });
 */
export const useBridgeApiTokensByChain = ({
  params,
  queryOptions,
}: UseBridgeApiTokensByChainParams = {}): UseQueryResult<GetBridgeTokensByChainResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const chainKey = params?.chainKey;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['bridgeApi', 'tokens', chainKey],
    queryFn: async (): Promise<GetBridgeTokensByChainResponseV2 | undefined> => {
      if (!chainKey) return undefined;
      return unwrapResult(await sodax.api.bridge.getTokensByChain(chainKey, apiConfig));
    },
    enabled: !!chainKey && chainKey.length > 0,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
