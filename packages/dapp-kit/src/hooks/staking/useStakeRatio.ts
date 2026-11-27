import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseStakeRatioParams = ReadHookParams<
  [bigint, bigint],
  {
    amount: bigint | undefined;
  }
>;

/** Throws on `!ok`. */
export function useStakeRatio({
  params,
  queryOptions,
}: UseStakeRatioParams = {}): UseQueryResult<[bigint, bigint], Error> {
  const { sodax } = useSodaxContext();
  const amount = params?.amount;

  return useQuery<[bigint, bigint], Error>({
    queryKey: ['staking', 'stakeRatio', amount?.toString()],
    queryFn: async () => {
      if (amount === undefined) {
        throw new Error('amount is required');
      }
      const result = await sodax.staking.getStakeRatio(amount);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: amount !== undefined,
    refetchInterval: 10_000,
    ...queryOptions,
  });
}
