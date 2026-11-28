import type { InstantUnstakeParams } from '@sodax/sdk';
import type { SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseInstantUnstakeAllowanceParams<K extends SpokeChainKey = SpokeChainKey> = ReadHookParams<
  boolean,
  {
    payload: Omit<InstantUnstakeParams<K>, 'action'> | undefined;
  }
>;

/** Read-only (`raw: true`), so no `walletProvider` is needed. */
export function useInstantUnstakeAllowance<K extends SpokeChainKey = SpokeChainKey>({
  params,
  queryOptions,
}: UseInstantUnstakeAllowanceParams<K> = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  const payload = params?.payload;

  return useQuery<boolean, Error>({
    queryKey: [
      'staking',
      'allowance',
      payload?.srcChainKey,
      'instantUnstake',
      payload?.srcAddress,
      payload?.amount?.toString(),
    ],
    queryFn: async () => {
      if (!payload) {
        throw new Error('Params are required');
      }
      const result = await sodax.staking.isAllowanceValid({
        params: { ...payload, action: 'instantUnstake' },
        raw: true,
      });
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!payload,
    refetchInterval: 5_000,
    gcTime: 0,
    ...queryOptions,
  });
}
