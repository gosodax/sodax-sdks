import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { MoneyMarketAssetSuppliers } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from './unwrapResult.js';
import type { BackendPaginationParams } from './types.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBackendMoneyMarketAssetSuppliersParams = ReadHookParams<
  MoneyMarketAssetSuppliers | undefined,
  {
    reserveAddress: string | undefined;
    pagination: BackendPaginationParams;
  }
>;

export const useBackendMoneyMarketAssetSuppliers = ({
  params,
  queryOptions,
}: UseBackendMoneyMarketAssetSuppliersParams = {}): UseQueryResult<MoneyMarketAssetSuppliers | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const reserveAddress = params?.reserveAddress;
  const pagination = params?.pagination;

  return useQuery({
    queryKey: ['backend', 'mm', 'asset', 'suppliers', reserveAddress, pagination],
    queryFn: async (): Promise<MoneyMarketAssetSuppliers | undefined> => {
      if (!reserveAddress || !pagination?.offset || !pagination?.limit) {
        return undefined;
      }
      return unwrapResult(
        await sodax.backendApi.getMoneyMarketAssetSuppliers(reserveAddress, {
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
