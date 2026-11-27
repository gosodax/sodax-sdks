import type { ClPositionInfo, PoolKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UsePositionInfoResponse = {
  positionInfo: ClPositionInfo;
  isValid: boolean;
};

export type UsePositionInfoParams = ReadHookParams<
  UsePositionInfoResponse,
  {
    tokenId: string | null;
    poolKey: PoolKey | null;
  }
>;

/** Validates the position against the expected pool key; disabled when `tokenId` or `poolKey` is missing. */
export function usePositionInfo({
  params,
  queryOptions,
}: UsePositionInfoParams = {}): UseQueryResult<UsePositionInfoResponse, Error> {
  const { sodax } = useSodaxContext();
  const tokenId = params?.tokenId ?? null;
  const poolKey = params?.poolKey ?? null;

  return useQuery<UsePositionInfoResponse, Error>({
    queryKey: ['dex', 'positionInfo', tokenId, poolKey],
    queryFn: async () => {
      if (!tokenId || !poolKey) {
        throw new Error('Token ID and pool key are required');
      }

      const infoResult = await sodax.dex.clService.getPositionInfo(BigInt(tokenId), sodax.hubProvider.publicClient);
      if (!infoResult.ok) throw infoResult.error;
      const info = infoResult.value;

      const isValid =
        info.poolKey.currency0.toLowerCase() === poolKey.currency0.toLowerCase() &&
        info.poolKey.currency1.toLowerCase() === poolKey.currency1.toLowerCase() &&
        info.poolKey.fee === poolKey.fee;

      return { positionInfo: info, isValid };
    },
    enabled: tokenId !== null && tokenId !== '' && poolKey !== null,
    staleTime: 10_000,
    ...queryOptions,
  });
}
