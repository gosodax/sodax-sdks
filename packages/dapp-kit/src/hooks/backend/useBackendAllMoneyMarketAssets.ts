import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { MoneyMarketAsset } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from './unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBackendAllMoneyMarketAssetsParams = ReadHookParams<MoneyMarketAsset[]>;

export const useBackendAllMoneyMarketAssets = ({
  queryOptions,
}: UseBackendAllMoneyMarketAssetsParams = {}): UseQueryResult<MoneyMarketAsset[], Error> => {
  const { sodax } = useSodaxContext();

  return useQuery<MoneyMarketAsset[], Error>({
    queryKey: ['backend', 'mm', 'assets', 'all'],
    queryFn: async (): Promise<MoneyMarketAsset[]> => {
      return unwrapResult(await sodax.backendApi.getAllMoneyMarketAssets());
    },
    retry: 3,
    ...queryOptions,
  });
};
