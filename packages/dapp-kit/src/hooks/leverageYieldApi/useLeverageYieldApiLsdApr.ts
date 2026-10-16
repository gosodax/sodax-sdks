import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LeverageYieldLsdAprV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiLsdAprParams = ReadHookParams<
  LeverageYieldLsdAprV2 | undefined,
  {
    vault: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to fetch the off-chain LSD staking-APR snapshot for a leverage-yield vault via the leverage-yield API —
 * `sodax.api.leverageYield.getLsdApr`.
 *
 * @example
 * const { data } = useLeverageYieldApiLsdApr({ params: { vault: '0x...' } });
 */
export const useLeverageYieldApiLsdApr = ({
  params,
  queryOptions,
}: UseLeverageYieldApiLsdAprParams = {}): UseQueryResult<LeverageYieldLsdAprV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const vault = params?.vault;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'lsdApr', vault],
    queryFn: async (): Promise<LeverageYieldLsdAprV2 | undefined> => {
      if (!vault) return undefined;
      return unwrapResult(await sodax.api.leverageYield.getLsdApr({ vault }, apiConfig));
    },
    enabled: !!vault && vault.length > 0,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
