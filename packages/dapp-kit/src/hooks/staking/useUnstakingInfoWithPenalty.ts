import type { UnstakeRequestWithPenalty, UnstakingInfo } from '@sodax/sdk';
import type { SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UnstakingInfoWithPenalty = UnstakingInfo & { requestsWithPenalty: UnstakeRequestWithPenalty[] };

export type UseUnstakingInfoWithPenaltyParams = ReadHookParams<
  UnstakingInfoWithPenalty,
  {
    srcAddress: `0x${string}` | undefined;
    srcChainKey: SpokeChainKey | undefined;
  }
>;

/** Includes computed early-exit penalties. Throws on `!ok`. */
export function useUnstakingInfoWithPenalty({
  params,
  queryOptions,
}: UseUnstakingInfoWithPenaltyParams = {}): UseQueryResult<UnstakingInfoWithPenalty, Error> {
  const { sodax } = useSodaxContext();
  const srcAddress = params?.srcAddress;
  const srcChainKey = params?.srcChainKey;

  return useQuery<UnstakingInfoWithPenalty, Error>({
    queryKey: ['staking', 'unstakingInfoWithPenalty', srcChainKey, srcAddress],
    queryFn: async () => {
      if (!srcAddress || !srcChainKey) {
        throw new Error('srcAddress and srcChainKey are required');
      }
      const result = await sodax.staking.getUnstakingInfoWithPenalty(srcAddress, srcChainKey);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!srcAddress && !!srcChainKey,
    refetchInterval: 5_000,
    ...queryOptions,
  });
}
