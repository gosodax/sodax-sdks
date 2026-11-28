import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address, LeveragePosition } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeveragePositionInfoParams = ReadHookParams<LeveragePosition, { position: Address | undefined }>;

/** A position's static descriptor (fixed at creation, so not polled); see `useLeveragePositionAccount` for live values. */
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
