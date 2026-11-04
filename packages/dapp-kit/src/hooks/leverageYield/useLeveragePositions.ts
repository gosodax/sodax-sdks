import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeveragePositionsParams = ReadHookParams<readonly Address[], { owner: Address | undefined }>;

/**
 * Lists the leverage-position clones owned by `owner`, in creation order.
 *
 * Positions are the unpooled counterpart to leverage-yield vaults: each is its own AAVE
 * account, so one owner can hold several at different eMode categories and leverage tiers.
 * There is no static registry — discovery goes through the factory.
 *
 * Requires `leverageYield.positionFactory` in the `Sodax` config; without it the underlying
 * SDK call fails with a lookup error rather than guessing an address.
 *
 * @example
 * ```typescript
 * const { data: positions } = useLeveragePositions({ params: { owner } });
 * ```
 */
export function useLeveragePositions({
  params,
  queryOptions,
}: UseLeveragePositionsParams = {}): UseQueryResult<readonly Address[], Error> {
  const { sodax } = useSodaxContext();
  const owner = params?.owner;

  return useQuery<readonly Address[], Error>({
    queryKey: ['leverageYield', 'positions', owner],
    queryFn: async () => {
      if (!owner) throw new Error('owner is required');
      const result = await sodax.leverageYield.listPositions(owner);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!owner,
    ...queryOptions,
  });
}
