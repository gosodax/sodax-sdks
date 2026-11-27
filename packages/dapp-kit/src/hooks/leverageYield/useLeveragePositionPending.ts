import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address, LeveragePositionPendingState } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeveragePositionPendingParams = ReadHookParams<
  LeveragePositionPendingState,
  { position: Address | undefined }
>;

/**
 * A position's operation slot. Gate controls on `isLive` (one intent at a time); offer settle on `needsSettle`.
 * Polled well inside the 5-minute intent deadline since fills/expiry happen without user action.
 */
export function useLeveragePositionPending({
  params,
  queryOptions,
}: UseLeveragePositionPendingParams = {}): UseQueryResult<LeveragePositionPendingState, Error> {
  const { sodax } = useSodaxContext();
  const position = params?.position;

  return useQuery<LeveragePositionPendingState, Error>({
    queryKey: ['leverageYield', 'positionPending', position],
    queryFn: async () => {
      if (!position) throw new Error('position is required');
      const result = await sodax.leverageYield.getPositionPendingState(position);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!position,
    refetchInterval: 15_000,
    ...queryOptions,
  });
}
