import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseInstantUnstakeRatioParams = ReadHookParams<
  bigint,
  {
    amount: bigint | undefined;
  }
>;

/** SODA received for instant-unstaking the xSODA amount, after slippage. Throws on `!ok`. */
export function useInstantUnstakeRatio({
  params,
  queryOptions,
}: UseInstantUnstakeRatioParams = {}): UseQueryResult<bigint, Error> {
  const { sodax } = useSodaxContext();
  const amount = params?.amount;

  return useQuery<bigint, Error>({
    queryKey: ['staking', 'instantUnstakeRatio', amount?.toString()],
    queryFn: async () => {
      if (amount === undefined) {
        throw new Error('amount is required');
      }
      const result = await sodax.staking.getInstantUnstakeRatio(amount);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: amount !== undefined,
    refetchInterval: 10_000,
    ...queryOptions,
  });
}
