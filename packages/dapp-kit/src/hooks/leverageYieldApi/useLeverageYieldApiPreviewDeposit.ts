import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { PreviewDepositResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiPreviewDepositParams = ReadHookParams<
  PreviewDepositResponseV2 | undefined,
  {
    vault: string | undefined;
    assets: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to preview the shares minted for depositing `assets` (ERC-4626 previewDeposit) via the leverage-yield API —
 * `sodax.api.leverageYield.previewDeposit`.
 *
 * @example
 * const { data } = useLeverageYieldApiPreviewDeposit({ params: { vault: '0x...', assets: '1000000000000000000' } });
 */
export const useLeverageYieldApiPreviewDeposit = ({
  params,
  queryOptions,
}: UseLeverageYieldApiPreviewDepositParams = {}): UseQueryResult<PreviewDepositResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const vault = params?.vault;
  const assets = params?.assets;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'previewDeposit', vault, assets],
    queryFn: async (): Promise<PreviewDepositResponseV2 | undefined> => {
      if (!vault || assets === undefined) return undefined;
      return unwrapResult(await sodax.api.leverageYield.previewDeposit({ vault, assets }, apiConfig));
    },
    enabled: !!vault && vault.length > 0 && assets !== undefined,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
