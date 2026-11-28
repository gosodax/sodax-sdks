import type { MoneyMarketParams } from '@sodax/sdk';
import type { SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseMMAllowanceParams<K extends SpokeChainKey> = ReadHookParams<
  boolean,
  {
    payload: MoneyMarketParams<K> | undefined;
  }
>;

/**
 * `borrow`/`withdraw` need no approval: the query stays disabled and `data` is seeded with `true`. Query key must
 * match the `['mm', 'allowance', srcChainKey, token, action]` invalidations from `useMMApprove` and mutations.
 */
export function useMMAllowance<K extends SpokeChainKey>({
  params,
  queryOptions,
}: UseMMAllowanceParams<K> = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  const payload = params?.payload;
  const needsApproval = payload?.action !== 'borrow' && payload?.action !== 'withdraw';

  return useQuery<boolean, Error>({
    queryKey: ['mm', 'allowance', payload?.srcChainKey, payload?.token, payload?.action],
    queryFn: async () => {
      if (!payload) {
        throw new Error('Params are required');
      }

      if (!needsApproval) {
        return true;
      }

      const result = await sodax.moneyMarket.isAllowanceValid({ params: payload });
      if (!result.ok) throw result.error;
      return result.value;
    },
    initialData: () => (payload && !needsApproval ? true : undefined),
    enabled: !!payload && needsApproval,
    refetchInterval: 5000,
    gcTime: 0,
    ...queryOptions,
  });
}
