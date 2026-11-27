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
 * Hook for checking token allowance / trustline sufficiency for money market operations.
 *
 * `borrow` and `withdraw` need no approval: the query stays disabled for them and `data` is seeded
 * with `true`, so callers gating on `data` are not blocked and see no `isLoading` flash.
 *
 * The query key matches the invalidation keys emitted by `useMMApprove` and the four mutation
 * hooks: `['mm', 'allowance', srcChainKey, token, action]`.
 *
 * @example
 * ```tsx
 * const { data: hasAllowance } = useMMAllowance({ params: { payload: supplyParams } });
 * ```
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
