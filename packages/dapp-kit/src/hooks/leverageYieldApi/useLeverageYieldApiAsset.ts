import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { VaultAssetResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiAssetParams = ReadHookParams<
  VaultAssetResponseV2 | undefined,
  {
    vault: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

export const useLeverageYieldApiAsset = ({
  params,
  queryOptions,
}: UseLeverageYieldApiAssetParams = {}): UseQueryResult<VaultAssetResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const vault = params?.vault;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'asset', vault],
    queryFn: async (): Promise<VaultAssetResponseV2 | undefined> => {
      if (!vault) return undefined;
      return unwrapResult(await sodax.api.leverageYield.getAsset({ vault }, apiConfig));
    },
    enabled: !!vault && vault.length > 0,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
