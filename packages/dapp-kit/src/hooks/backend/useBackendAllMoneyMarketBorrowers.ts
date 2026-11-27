import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { MoneyMarketBorrowers } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from './unwrapResult.js';
import type { BackendPaginationParams } from './types.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBackendAllMoneyMarketBorrowersParams = ReadHookParams<
  MoneyMarketBorrowers | undefined,
  {
    pagination: BackendPaginationParams;
  }
>;

export const useBackendAllMoneyMarketBorrowers = ({
  params,
  queryOptions,
}: UseBackendAllMoneyMarketBorrowersParams = {}): UseQueryResult<MoneyMarketBorrowers | undefined> => {
  const { sodax } = useSodaxContext();
  const pagination = params?.pagination;

  return useQuery({
    queryKey: ['backend', 'mm', 'borrowers', 'all', pagination],
    queryFn: async (): Promise<MoneyMarketBorrowers | undefined> => {
      if (!pagination?.offset || !pagination?.limit) {
        return undefined;
      }
      return unwrapResult(
        await sodax.backendApi.getAllMoneyMarketBorrowers({
          offset: pagination.offset,
          limit: pagination.limit,
        }),
      );
    },
    enabled: !!pagination?.offset && !!pagination?.limit,
    retry: 3,
    ...queryOptions,
  });
};
