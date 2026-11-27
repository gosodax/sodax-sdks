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
