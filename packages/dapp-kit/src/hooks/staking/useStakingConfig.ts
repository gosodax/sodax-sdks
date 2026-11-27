import type { StakingConfig } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseStakingConfigParams = ReadHookParams<StakingConfig>;

/** Throws on `!ok`. */
export function useStakingConfig({ queryOptions }: UseStakingConfigParams = {}): UseQueryResult<StakingConfig, Error> {
  const { sodax } = useSodaxContext();

  return useQuery<StakingConfig, Error>({
    queryKey: ['staking', 'config'],
    queryFn: async () => {
      const result = await sodax.staking.getStakingConfig();
      if (!result.ok) throw result.error;
      return result.value;
    },
    staleTime: Number.POSITIVE_INFINITY,
    ...queryOptions,
  });
}
