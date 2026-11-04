import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address, LeveragePositionPendingState } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeveragePositionPendingParams = ReadHookParams<
  LeveragePositionPendingState,
  { position: Address | undefined }
>;

/**
 * A position's operation slot: what it recorded, whether that intent is still live, and whether it
 * is stuck resolved-but-unswept.
 *
 * Gate leverage controls on `isLive` — a position permits one intent at a time, so offering a button
 * that can only revert is worse than disabling it. Offer a settle on `needsSettle`: that is the state
 * where the intent is gone but the position still holds the grant and any contribution, and it is
 * invisible from `isLive` alone.
 *
 * Polled, because both change without the user acting: a solver fills, or the intent expires. The
 * interval sits well inside the 5-minute intent deadline so a resolution shows up while it matters.
 *
 * @example
 * ```typescript
 * const { data: slot } = useLeveragePositionPending({ params: { position } });
 * if (slot?.needsSettle) offerSettle();
 * ```
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
