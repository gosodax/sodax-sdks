import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { OracleMarketsResponse } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from './unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBackendOracleMarketsParams = ReadHookParams<OracleMarketsResponse>;

/**
 * Hook for fetching the oracle candle store's discovery payload (quote currency,
 * selectable intervals, and covered symbols) from the backend API.
 *
 * @example
 * const { data: markets } = useBackendOracleMarkets();
 */
export const useBackendOracleMarkets = ({
  queryOptions,
}: UseBackendOracleMarketsParams = {}): UseQueryResult<OracleMarketsResponse, Error> => {
  const { sodax } = useSodaxContext();

  return useQuery<OracleMarketsResponse, Error>({
    queryKey: ['backend', 'oracle', 'markets'],
    queryFn: async (): Promise<OracleMarketsResponse> => {
      return unwrapResult(await sodax.backendApi.getOracleMarkets());
    },
    staleTime: 60 * 1000,
    retry: 3,
    ...queryOptions,
  });
};
