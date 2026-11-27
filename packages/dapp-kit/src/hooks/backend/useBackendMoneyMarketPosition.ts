import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { MoneyMarketPosition } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from './unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBackendMoneyMarketPositionParams = ReadHookParams<
  MoneyMarketPosition | undefined,
  {
    userAddress: string | undefined;
  }
>;

export const useBackendMoneyMarketPosition = ({
  params,
  queryOptions,
}: UseBackendMoneyMarketPositionParams = {}): UseQueryResult<MoneyMarketPosition | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const userAddress = params?.userAddress;

  return useQuery({
    queryKey: ['backend', 'mm', 'position', userAddress],
    queryFn: async (): Promise<MoneyMarketPosition | undefined> => {
      if (!userAddress) return undefined;
      return unwrapResult(await sodax.backendApi.getMoneyMarketPosition(userAddress));
    },
    enabled: !!userAddress && userAddress.length > 0,
    retry: 3,
    ...queryOptions,
  });
};
