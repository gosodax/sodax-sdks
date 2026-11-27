import type { UnstakingInfo } from '@sodax/sdk';
import type { SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseUnstakingInfoParams = ReadHookParams<
  UnstakingInfo,
  {
    srcAddress: `0x${string}` | undefined;
    srcChainKey: SpokeChainKey | undefined;
  }
>;

/** Throws on `!ok`. */
export function useUnstakingInfo({
  params,
  queryOptions,
}: UseUnstakingInfoParams = {}): UseQueryResult<UnstakingInfo, Error> {
  const { sodax } = useSodaxContext();
  const srcAddress = params?.srcAddress;
  const srcChainKey = params?.srcChainKey;

  return useQuery<UnstakingInfo, Error>({
    queryKey: ['staking', 'unstakingInfo', srcChainKey, srcAddress],
    queryFn: async () => {
      if (!srcAddress || !srcChainKey) {
        throw new Error('srcAddress and srcChainKey are required');
      }
      const result = await sodax.staking.getUnstakingInfo(srcAddress, srcChainKey);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!srcAddress && !!srcChainKey,
    refetchInterval: 5_000,
    ...queryOptions,
  });
}
