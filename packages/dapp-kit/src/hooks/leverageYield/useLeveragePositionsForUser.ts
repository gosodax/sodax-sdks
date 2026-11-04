import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address, SpokeChainKey } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeveragePositionsForUserParams = ReadHookParams<
  readonly Address[],
  { spokeChainKey: SpokeChainKey | undefined; spokeAddress: string | undefined }
>;

/**
 * Lists a user's leverage positions from their spoke-side address and chain.
 *
 * Positions are owned by the user's hub wallet, not their EOA, so discovery resolves that address
 * first — the wallet router for a Sonic user, the cross-chain wallet for a spoke user, via one
 * call. Use this in user-facing code; {@link useLeveragePositions} takes a hub address directly
 * and will find nothing if handed an EOA.
 *
 * @example
 * ```typescript
 * const { data: positions } = useLeveragePositionsForUser({
 *   params: { spokeChainKey: chain, spokeAddress: account.address },
 * });
 * ```
 */
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
