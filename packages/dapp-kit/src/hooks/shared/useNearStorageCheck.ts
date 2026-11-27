import { ChainKeys, type SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from './useSodaxContext.js';
import type { ReadHookParams } from './types.js';

export type UseNearStorageCheckParams = ReadHookParams<
  boolean,
  {
    token: string | undefined;
    accountId: string | undefined;
    chainId: SpokeChainKey | undefined;
  }
>;

/**
 * Whether `accountId` is NEP-141 storage-registered to receive `token` on NEAR. Resolves `true` when
 * `chainId` is not NEAR; native NEAR always reads as registered.
 */
export function useNearStorageCheck({
  params,
  queryOptions,
}: UseNearStorageCheckParams = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  const token = params?.token;
  const accountId = params?.accountId;
  const chainId = params?.chainId;

  return useQuery<boolean, Error>({
    queryKey: ['shared', 'nearStorageCheck', chainId, token, accountId],
    queryFn: async () => {
      if (chainId !== ChainKeys.NEAR_MAINNET) return true;
      if (!token || !accountId) return false;
      return sodax.spoke.near.isStorageRegistered(token, accountId);
    },
    enabled: !!token && !!accountId,
    ...queryOptions,
  });
}
