import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address, LeveragePositionAccount } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeveragePositionAccountParams = ReadHookParams<
  LeveragePositionAccount,
  { position: Address | undefined }
>;

/**
 * Live AAVE account snapshot (pool `getUserAccountData`). Health factor is WAD; below 1e18 the position
 * is liquidatable with no keeper to deleverage it. Polled every 30s since debt accrues continuously.
 */
export function useLeveragePositionAccount({
  params,
  queryOptions,
}: UseLeveragePositionAccountParams = {}): UseQueryResult<LeveragePositionAccount, Error> {
  const { sodax } = useSodaxContext();
  const position = params?.position;

  return useQuery<LeveragePositionAccount, Error>({
    queryKey: ['leverageYield', 'positionAccount', position],
    queryFn: async () => {
      if (!position) throw new Error('position is required');
      const result = await sodax.leverageYield.getPositionAccount(position);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!position,
    refetchInterval: 30_000,
    ...queryOptions,
  });
}
