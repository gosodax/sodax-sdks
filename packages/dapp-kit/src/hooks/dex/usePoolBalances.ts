import type { PoolData, PoolKey } from '@sodax/sdk';
import type { SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { erc20Abi } from 'viem';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UsePoolBalancesResponse = {
  token0Balance: bigint;
  token1Balance: bigint;
};

export type UsePoolBalancesParams = ReadHookParams<
  UsePoolBalancesResponse,
  {
    poolData: PoolData | null;
    poolKey: PoolKey | null;
    spokeChainKey: SpokeChainKey | undefined;
    userAddress: string | undefined;
  }
>;

export function usePoolBalances({
  params,
  queryOptions,
}: UsePoolBalancesParams = {}): UseQueryResult<UsePoolBalancesResponse, Error> {
  const { sodax } = useSodaxContext();
  const poolData = params?.poolData ?? null;
  const poolKey = params?.poolKey ?? null;
  const spokeChainKey = params?.spokeChainKey;
  const userAddress = params?.userAddress;

  return useQuery<UsePoolBalancesResponse, Error>({
    queryKey: ['dex', 'poolBalances', poolData?.poolId, spokeChainKey, userAddress],
    queryFn: async () => {
      if (!poolData || !poolKey || !spokeChainKey || !userAddress) {
        throw new Error('poolData, poolKey, spokeChainKey, and userAddress are required');
      }

      const hubWallet = await sodax.hubProvider.getUserHubWalletAddress(userAddress, spokeChainKey);

      const [token0Balance, token1Balance] = await Promise.all([
        sodax.hubProvider.publicClient.readContract({
          address: poolData.token0.address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [hubWallet],
        }),
        sodax.hubProvider.publicClient.readContract({
          address: poolData.token1.address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [hubWallet],
        }),
      ]);

      return { token0Balance, token1Balance };
    },
    enabled: !!poolData && !!poolKey && !!spokeChainKey && !!userAddress,
    staleTime: 5_000,
    refetchInterval: 10_000,
    ...queryOptions,
  });
}
