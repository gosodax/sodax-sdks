import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { GetLeverageVaultsResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiVaultsParams = ReadHookParams<
  GetLeverageVaultsResponseV2,
  {
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to fetch the registry of deployed leverage-yield vaults via the leverage-yield API —
 * `sodax.api.leverageYield.getVaults`.
 *
 * @example
 * const { data: vaults } = useLeverageYieldApiVaults();
 */
export const useLeverageYieldApiVaults = ({
  params,
  queryOptions,
}: UseLeverageYieldApiVaultsParams = {}): UseQueryResult<GetLeverageVaultsResponseV2, Error> => {
  const { sodax } = useSodaxContext();
  const apiConfig = params?.apiConfig;

  return useQuery<GetLeverageVaultsResponseV2, Error>({
    queryKey: ['leverageYieldApi', 'vaults'],
    queryFn: async (): Promise<GetLeverageVaultsResponseV2> =>
      unwrapResult(await sodax.api.leverageYield.getVaults(apiConfig)),
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
