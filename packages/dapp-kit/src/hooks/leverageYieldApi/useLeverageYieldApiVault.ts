import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { GetLeverageVaultResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiVaultParams = ReadHookParams<
  GetLeverageVaultResponseV2 | undefined,
  {
    name: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to fetch a single vault descriptor by its lsoda* share-token name via the
 * leverage-yield API — `sodax.api.leverageYield.getVault`.
 *
 * @example
 * const { data: vault } = useLeverageYieldApiVault({ params: { name: 'lsodaWEETH' } });
 */
export const useLeverageYieldApiVault = ({
  params,
  queryOptions,
}: UseLeverageYieldApiVaultParams = {}): UseQueryResult<GetLeverageVaultResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const name = params?.name;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'vault', name],
    queryFn: async (): Promise<GetLeverageVaultResponseV2 | undefined> => {
      if (!name) return undefined;
      return unwrapResult(await sodax.api.leverageYield.getVault(name, apiConfig));
    },
    enabled: !!name && name.length > 0,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
