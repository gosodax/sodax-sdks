import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { VaultTotalAssetsResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiTotalAssetsParams = ReadHookParams<
  VaultTotalAssetsResponseV2 | undefined,
  {
    vault: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to fetch the total assets managed by the vault for a leverage-yield vault via the leverage-yield API —
 * `sodax.api.leverageYield.getTotalAssets`.
 *
 * @example
 * const { data } = useLeverageYieldApiTotalAssets({ params: { vault: '0x...' } });
 */
export const useLeverageYieldApiTotalAssets = ({
  params,
  queryOptions,
}: UseLeverageYieldApiTotalAssetsParams = {}): UseQueryResult<VaultTotalAssetsResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const vault = params?.vault;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'totalAssets', vault],
    queryFn: async (): Promise<VaultTotalAssetsResponseV2 | undefined> => {
      if (!vault) return undefined;
      return unwrapResult(await sodax.api.leverageYield.getTotalAssets({ vault }, apiConfig));
    },
    enabled: !!vault && vault.length > 0,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
