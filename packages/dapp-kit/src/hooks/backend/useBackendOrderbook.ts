import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { OrderbookResponse } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from './unwrapResult.js';
import type { BackendPaginationParams } from './types.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBackendOrderbookParams = ReadHookParams<
  OrderbookResponse,
  {
    pagination: BackendPaginationParams;
  }
>;

export const useBackendOrderbook = ({
  params,
  queryOptions,
}: UseBackendOrderbookParams = {}): UseQueryResult<OrderbookResponse> => {
  const { sodax } = useSodaxContext();
  const pagination = params?.pagination;

  return useQuery<OrderbookResponse, Error>({
    queryKey: ['backend', 'orderbook', pagination?.offset, pagination?.limit],
    queryFn: async (): Promise<OrderbookResponse> => {
      if (!pagination?.offset || !pagination?.limit) {
        throw new Error('Pagination offset and limit are required');
      }
      return unwrapResult(await sodax.backendApi.getOrderbook(pagination));
    },
    enabled: !!pagination?.offset && !!pagination?.limit,
    staleTime: 30 * 1000,
    retry: 3,
    ...queryOptions,
  });
};
