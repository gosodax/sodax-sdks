import type { UserIntentsResponse, Address } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from './unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBackendUserIntentsParams = ReadHookParams<
  UserIntentsResponse | undefined,
  {
    userAddress: Address | undefined;
    startDate?: number;
    endDate?: number;
  }
>;

export const useBackendUserIntents = ({
  params,
  queryOptions,
}: UseBackendUserIntentsParams = {}): UseQueryResult<UserIntentsResponse | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const userAddress = params?.userAddress;
  const startDate = params?.startDate;
  const endDate = params?.endDate;

  return useQuery({
    queryKey: ['backend', 'intent', 'user', userAddress, startDate, endDate],
    queryFn: async (): Promise<UserIntentsResponse | undefined> => {
      if (!userAddress) return undefined;
      return unwrapResult(await sodax.backendApi.getUserIntents({ userAddress, startDate, endDate }));
    },
    enabled: !!userAddress && userAddress.length > 0,
    retry: 3,
    ...queryOptions,
  });
};
