import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address, LeveragePositionCollateral } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeveragePositionCollateralParams = ReadHookParams<
  LeveragePositionCollateral,
  { position: Address | undefined; collateral?: Address }
>;

/**
 * Exact aToken collateral balance; use this (not the account snapshot's oracle-priced total) for transaction
 * amounts, since over-asking on decrease-leverage expires as an unfillable intent instead of failing up front.
 */
export function useLeveragePositionCollateral({
  params,
  queryOptions,
}: UseLeveragePositionCollateralParams = {}): UseQueryResult<LeveragePositionCollateral, Error> {
  const { sodax } = useSodaxContext();
  const position = params?.position;
  const collateral = params?.collateral;

  return useQuery<LeveragePositionCollateral, Error>({
    queryKey: ['leverageYield', 'positionCollateral', position, collateral],
    queryFn: async () => {
      if (!position) throw new Error('position is required');
      const result = await sodax.leverageYield.getPositionCollateralBalance(position, collateral);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!position,
    refetchInterval: 30_000,
    ...queryOptions,
  });
}
