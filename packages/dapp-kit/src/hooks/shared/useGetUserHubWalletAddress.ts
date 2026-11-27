import type { SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from './useSodaxContext.js';
import { resolveBtcReadAddress } from '../bitcoin/resolveBtcReadAddress.js';
import type { Address } from 'viem';
import type { ReadHookParams } from './types.js';

export type UseGetUserHubWalletAddressParams = ReadHookParams<
  Address,
  {
    spokeChainId?: SpokeChainKey;
    spokeAddress?: string;
  }
>;

/** Unlike `useDeriveUserWalletAddress`, uses the wallet router address (not CREATE3) for the hub chain. */
export function useGetUserHubWalletAddress({
  params,
  queryOptions,
}: UseGetUserHubWalletAddressParams = {}): UseQueryResult<Address, Error> {
  const { sodax } = useSodaxContext();
  const spokeChainId = params?.spokeChainId;
  const spokeAddress = params?.spokeAddress;

  return useQuery<Address, Error>({
    queryKey: ['shared', 'userHubWalletAddress', spokeChainId, spokeAddress],
    queryFn: async (): Promise<Address> => {
      if (!spokeChainId || !spokeAddress) {
        throw new Error('Spoke chain id and address are required');
      }
      return await sodax.hubProvider.getUserHubWalletAddress(
        resolveBtcReadAddress(spokeChainId, spokeAddress),
        spokeChainId,
      );
    },
    enabled: !!spokeChainId && !!spokeAddress,
    refetchInterval: false,
    ...queryOptions,
  });
}
