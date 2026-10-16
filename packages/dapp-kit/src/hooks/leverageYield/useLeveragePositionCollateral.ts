import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address, LeveragePositionCollateral } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeveragePositionCollateralParams = ReadHookParams<
  LeveragePositionCollateral,
  { position: Address | undefined; collateral?: Address }
>;

/**
 * Reads a leverage position's collateral as an exact aToken balance.
 *
 * Use this, not `useLeveragePositionAccount().totalCollateralBase`, whenever an amount is going into
 * a transaction. The account snapshot is denominated in the oracle's base currency at 8 decimals, so
 * dividing it back out by a price gives an amount near the balance rather than the balance — and a
 * decrease-leverage call for more collateral than the position holds expires as an unfillable intent
 * instead of failing up front.
 *
 * @example
 * ```typescript
 * const { data: collateral } = useLeveragePositionCollateral({ params: { position } });
 * // collateral.balance is what a full exit sells
 * ```
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
    // Interest accrues into the balance continuously, so match the account snapshot's cadence.
    refetchInterval: 30_000,
    ...queryOptions,
  });
}
