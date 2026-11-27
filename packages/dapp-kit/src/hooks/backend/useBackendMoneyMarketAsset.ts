import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { MoneyMarketAsset } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from './unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBackendMoneyMarketAssetParams = ReadHookParams<
  MoneyMarketAsset | undefined,
  {
    reserveAddress: string | undefined;
  }
>;

export const useBackendMoneyMarketAsset = ({
  params,
  queryOptions,
}: UseBackendMoneyMarketAssetParams = {}): UseQueryResult<MoneyMarketAsset | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const reserveAddress = params?.reserveAddress;

  return useQuery({
    queryKey: ['backend', 'mm', 'asset', reserveAddress],
    queryFn: async (): Promise<MoneyMarketAsset | undefined> => {
      if (!reserveAddress) return undefined;
      return unwrapResult(await sodax.backendApi.getMoneyMarketAsset(reserveAddress));
    },
    enabled: !!reserveAddress && reserveAddress.length > 0,
    retry: 3,
    ...queryOptions,
  });
};
