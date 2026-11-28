import type { StakingInfo } from '@sodax/sdk';
import type { SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseStakingInfoParams = ReadHookParams<
  StakingInfo,
  {
    srcAddress: `0x${string}` | undefined;
    srcChainKey: SpokeChainKey | undefined;
  }
>;

/** Throws on `!ok`. */
export function useStakingInfo({
  params,
  queryOptions,
}: UseStakingInfoParams = {}): UseQueryResult<StakingInfo, Error> {
  const { sodax } = useSodaxContext();
  const srcAddress = params?.srcAddress;
  const srcChainKey = params?.srcChainKey;

  return useQuery<StakingInfo, Error>({
    queryKey: ['staking', 'info', srcChainKey, srcAddress],
    queryFn: async () => {
      if (!srcAddress || !srcChainKey) {
        throw new Error('srcAddress and srcChainKey are required');
      }
      const result = await sodax.staking.getStakingInfoFromSpoke(srcAddress, srcChainKey);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!srcAddress && !!srcChainKey,
    refetchInterval: 5_000,
    ...queryOptions,
  });
}
