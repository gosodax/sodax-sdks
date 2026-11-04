import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LeverageYieldPositionV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiPositionParams = ReadHookParams<
  LeverageYieldPositionV2 | undefined,
  {
    vault: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to fetch a leveraged-position snapshot for a leverage-yield vault via the leverage-yield API —
 * `sodax.api.leverageYield.getPosition`.
 *
 * @example
 * const { data } = useLeverageYieldApiPosition({ params: { vault: '0x...' } });
 */
export const useLeverageYieldApiPosition = ({
  params,
  queryOptions,
}: UseLeverageYieldApiPositionParams = {}): UseQueryResult<LeverageYieldPositionV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const vault = params?.vault;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'position', vault],
    queryFn: async (): Promise<LeverageYieldPositionV2 | undefined> => {
      if (!vault) return undefined;
      return unwrapResult(await sodax.api.leverageYield.getPosition({ vault }, apiConfig));
    },
    enabled: !!vault && vault.length > 0,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
