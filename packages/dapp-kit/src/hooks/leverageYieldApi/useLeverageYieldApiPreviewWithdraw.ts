import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { PreviewWithdrawResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiPreviewWithdrawParams = ReadHookParams<
  PreviewWithdrawResponseV2 | undefined,
  {
    vault: string | undefined;
    assets: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/** ERC-4626 `previewWithdraw`: shares burned to withdraw `assets`. */
export const useLeverageYieldApiPreviewWithdraw = ({
  params,
  queryOptions,
}: UseLeverageYieldApiPreviewWithdrawParams = {}): UseQueryResult<PreviewWithdrawResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const vault = params?.vault;
  const assets = params?.assets;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'previewWithdraw', vault, assets],
    queryFn: async (): Promise<PreviewWithdrawResponseV2 | undefined> => {
      if (!vault || assets === undefined) return undefined;
      return unwrapResult(await sodax.api.leverageYield.previewWithdraw({ vault, assets }, apiConfig));
    },
    enabled: !!vault && vault.length > 0 && assets !== undefined,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
