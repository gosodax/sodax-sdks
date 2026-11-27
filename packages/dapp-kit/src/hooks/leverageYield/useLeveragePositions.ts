import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeveragePositionsParams = ReadHookParams<readonly Address[], { owner: Address | undefined }>;

/** Position clones owned by a hub `owner`, in creation order. Requires `leverageYield.positionFactory` in the Sodax config. */
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
