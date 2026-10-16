import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LeverageYieldEffectiveAprV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiEffectiveAprParams = ReadHookParams<
  LeverageYieldEffectiveAprV2 | undefined,
  {
    vault: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to fetch the honest combined AAVE + LSD effective APR for a leverage-yield vault via the leverage-yield API —
 * `sodax.api.leverageYield.getEffectiveApr`.
 *
 * @example
 * const { data } = useLeverageYieldApiEffectiveApr({ params: { vault: '0x...' } });
 */
export const useLeverageYieldApiEffectiveApr = ({
  params,
  queryOptions,
}: UseLeverageYieldApiEffectiveAprParams = {}): UseQueryResult<LeverageYieldEffectiveAprV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const vault = params?.vault;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'effectiveApr', vault],
    queryFn: async (): Promise<LeverageYieldEffectiveAprV2 | undefined> => {
      if (!vault) return undefined;
      return unwrapResult(await sodax.api.leverageYield.getEffectiveApr({ vault }, apiConfig));
    },
    enabled: !!vault && vault.length > 0,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
