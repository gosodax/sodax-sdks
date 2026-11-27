import type { PoolData, PoolKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UsePoolDataParams = ReadHookParams<PoolData, { poolKey: PoolKey | null }>;

/** Disabled when `poolKey` is null. */
export function usePoolData({ params, queryOptions }: UsePoolDataParams = {}): UseQueryResult<PoolData, Error> {
  const { sodax } = useSodaxContext();
  const poolKey = params?.poolKey ?? null;

  return useQuery<PoolData, Error>({
    queryKey: ['dex', 'poolData', poolKey],
    queryFn: async () => {
      if (!poolKey) {
        throw new Error('Pool key is required');
      }
      const result = await sodax.dex.clService.getPoolData(poolKey, sodax.hubProvider.publicClient);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: poolKey !== null,
    staleTime: 10_000,
    refetchInterval: 30_000,
    ...queryOptions,
  });
}
