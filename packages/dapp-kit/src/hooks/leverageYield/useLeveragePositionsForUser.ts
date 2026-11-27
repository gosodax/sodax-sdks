import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address, SpokeChainKey } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeveragePositionsForUserParams = ReadHookParams<
  readonly Address[],
  { spokeChainKey: SpokeChainKey | undefined; spokeAddress: string | undefined }
>;

/** Resolves the user's hub wallet first, since positions are owned by it; {@link useLeveragePositions} finds nothing for an EOA. */
export function useLeveragePositionsForUser({
  params,
  queryOptions,
}: UseLeveragePositionsForUserParams = {}): UseQueryResult<readonly Address[], Error> {
  const { sodax } = useSodaxContext();
  const spokeChainKey = params?.spokeChainKey;
  const spokeAddress = params?.spokeAddress;

  return useQuery<readonly Address[], Error>({
    queryKey: ['leverageYield', 'positionsForUser', spokeChainKey, spokeAddress],
    queryFn: async () => {
      if (!spokeChainKey || !spokeAddress) throw new Error('spokeChainKey and spokeAddress are required');
      const result = await sodax.leverageYield.listPositionsForUser(spokeChainKey, spokeAddress);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!spokeChainKey && !!spokeAddress,
    ...queryOptions,
  });
}
