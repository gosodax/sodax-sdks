import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { OracleCandleInterval, OracleCandlesResponse } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from './unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBackendOracleCandlesParams = ReadHookParams<
  OracleCandlesResponse,
  {
    symbol: string;
    interval: OracleCandleInterval;
    /** Range start, UNIX seconds, inclusive. */
    from: number;
    /** Range end, UNIX seconds, exclusive; the range may cover at most 5000 buckets. */
    to: number;
  }
>;

/**
 * Hook for fetching USD OHLC candles for a symbol over the half-open range `[from, to)`
 * from the backend API. Responses are cached server-side for roughly 10 seconds.
 *
 * @example
 * const { data } = useBackendOracleCandles({
 *   params: { symbol: 'ETH', interval: '1h', from: 1756000000, to: 1756360000 },
 * });
 */
export const useBackendOracleCandles = ({
  params,
  queryOptions,
}: UseBackendOracleCandlesParams = {}): UseQueryResult<OracleCandlesResponse, Error> => {
  const { sodax } = useSodaxContext();

  return useQuery<OracleCandlesResponse, Error>({
    queryKey: ['backend', 'oracle', 'candles', params?.symbol, params?.interval, params?.from, params?.to],
    queryFn: async (): Promise<OracleCandlesResponse> => {
      if (!params) {
        throw new Error('symbol, interval, from and to are required');
      }
      return unwrapResult(await sodax.backendApi.getOracleCandles(params));
    },
    enabled: !!params?.symbol && !!params?.interval && params?.from != null && params?.to != null,
    staleTime: 10 * 1000,
    retry: 3,
    ...queryOptions,
  });
};
