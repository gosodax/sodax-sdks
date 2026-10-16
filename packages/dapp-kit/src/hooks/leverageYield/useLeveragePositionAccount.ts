import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address, LeveragePositionAccount } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeveragePositionAccountParams = ReadHookParams<
  LeveragePositionAccount,
  { position: Address | undefined }
>;

/**
 * Reads the live AAVE account snapshot for a leverage position — collateral, debt, LTV and
 * health factor.
 *
 * The figures come from the pool's `getUserAccountData`, not from the position contract,
 * which keeps no accounting of its own. Health factor is WAD (1e18); below 1e18 the position
 * is liquidatable, and there is no keeper deleveraging on the owner's behalf, so this is the
 * number a UI should surface most prominently. Debt accrues continuously, hence the 30s
 * default refresh.
 *
 * @example
 * ```typescript
 * const { data: account } = useLeveragePositionAccount({ params: { position } });
 * ```
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
