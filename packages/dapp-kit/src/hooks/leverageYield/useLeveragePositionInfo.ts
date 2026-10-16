import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address, LeveragePosition } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeveragePositionInfoParams = ReadHookParams<LeveragePosition, { position: Address | undefined }>;

/**
 * Reads a leverage position's static descriptor — owner, collateral, borrow token, and the
 * eMode category it was created with.
 *
 * All four are fixed at creation, so this never goes stale for a given position and is left
 * on the default cache behaviour rather than polled. Pair it with
 * `useLeveragePositionAccount` for the values that do move.
 *
 * @example
 * ```typescript
 * const { data: info } = useLeveragePositionInfo({ params: { position } });
 * ```
 */
export function useLeveragePositionInfo({
  params,
  queryOptions,
}: UseLeveragePositionInfoParams = {}): UseQueryResult<LeveragePosition, Error> {
  const { sodax } = useSodaxContext();
  const position = params?.position;

  return useQuery<LeveragePosition, Error>({
    queryKey: ['leverageYield', 'positionInfo', position],
    queryFn: async () => {
      if (!position) throw new Error('position is required');
      const result = await sodax.leverageYield.getPositionInfo(position);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!position,
    ...queryOptions,
  });
}
