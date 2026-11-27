import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseConvertedAssetsParams = ReadHookParams<
  bigint,
  {
    amount: bigint | undefined;
  }
>;

/** Converts xSODA shares to SODA at the vault rate. Throws on `!ok`. */
export function useConvertedAssets({
  params,
  queryOptions,
}: UseConvertedAssetsParams = {}): UseQueryResult<bigint, Error> {
  const { sodax } = useSodaxContext();
  const amount = params?.amount;

  return useQuery<bigint, Error>({
    queryKey: ['staking', 'convertedAssets', amount?.toString()],
    queryFn: async () => {
      if (amount === undefined) {
        throw new Error('amount is required');
      }
      const result = await sodax.staking.getConvertedAssets(amount);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: amount !== undefined,
    refetchInterval: 10_000,
    ...queryOptions,
  });
}
