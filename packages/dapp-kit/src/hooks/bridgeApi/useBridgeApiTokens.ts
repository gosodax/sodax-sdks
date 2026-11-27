import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { GetBridgeTokensResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBridgeApiTokensParams = ReadHookParams<
  GetBridgeTokensResponseV2,
  {
    apiConfig?: RequestOverrideConfig;
  }
>;

export const useBridgeApiTokens = ({
  params,
  queryOptions,
}: UseBridgeApiTokensParams = {}): UseQueryResult<GetBridgeTokensResponseV2, Error> => {
  const { sodax } = useSodaxContext();
  const apiConfig = params?.apiConfig;

  return useQuery<GetBridgeTokensResponseV2, Error>({
    queryKey: ['bridgeApi', 'tokens'],
    queryFn: async (): Promise<GetBridgeTokensResponseV2> => unwrapResult(await sodax.api.bridge.getTokens(apiConfig)),
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
