import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { MoneyMarketAssetBorrowers } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from './unwrapResult.js';
import type { BackendPaginationParams } from './types.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBackendMoneyMarketAssetBorrowersParams = ReadHookParams<
  MoneyMarketAssetBorrowers | undefined,
  {
    reserveAddress: string | undefined;
    pagination: BackendPaginationParams;
  }
>;

export const useBackendMoneyMarketAssetBorrowers = ({
  params,
  queryOptions,
}: UseBackendMoneyMarketAssetBorrowersParams = {}): UseQueryResult<MoneyMarketAssetBorrowers | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const reserveAddress = params?.reserveAddress;
  const pagination = params?.pagination;

  return useQuery({
    queryKey: ['backend', 'mm', 'asset', 'borrowers', reserveAddress, pagination],
    queryFn: async (): Promise<MoneyMarketAssetBorrowers | undefined> => {
      if (!reserveAddress || !pagination?.offset || !pagination?.limit) {
        return undefined;
      }
      return unwrapResult(
        await sodax.backendApi.getMoneyMarketAssetBorrowers(reserveAddress, {
          offset: pagination.offset,
          limit: pagination.limit,
        }),
      );
    },
    enabled: !!reserveAddress && !!pagination?.offset && !!pagination?.limit,
    retry: 3,
    ...queryOptions,
  });
};
