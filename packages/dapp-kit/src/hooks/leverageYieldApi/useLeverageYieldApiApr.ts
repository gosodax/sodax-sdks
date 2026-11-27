import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LeverageYieldAprV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiAprParams = ReadHookParams<
  LeverageYieldAprV2 | undefined,
  {
    vault: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/** AAVE-only steady-state APR; {@link useLeverageYieldApiEffectiveApr} includes LSD yield. */
export const useLeverageYieldApiApr = ({
  params,
  queryOptions,
}: UseLeverageYieldApiAprParams = {}): UseQueryResult<LeverageYieldAprV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const vault = params?.vault;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'apr', vault],
    queryFn: async (): Promise<LeverageYieldAprV2 | undefined> => {
      if (!vault) return undefined;
      return unwrapResult(await sodax.api.leverageYield.getApr({ vault }, apiConfig));
    },
    enabled: !!vault && vault.length > 0,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
