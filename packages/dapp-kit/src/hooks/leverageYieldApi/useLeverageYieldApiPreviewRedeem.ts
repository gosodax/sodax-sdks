import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { PreviewRedeemResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiPreviewRedeemParams = ReadHookParams<
  PreviewRedeemResponseV2 | undefined,
  {
    vault: string | undefined;
    shares: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to preview the assets returned for redeeming `shares` (ERC-4626 previewRedeem) via the leverage-yield API —
 * `sodax.api.leverageYield.previewRedeem`.
 *
 * @example
 * const { data } = useLeverageYieldApiPreviewRedeem({ params: { vault: '0x...', shares: '1000000000000000000' } });
 */
export const useLeverageYieldApiPreviewRedeem = ({
  params,
  queryOptions,
}: UseLeverageYieldApiPreviewRedeemParams = {}): UseQueryResult<PreviewRedeemResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const vault = params?.vault;
  const shares = params?.shares;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'previewRedeem', vault, shares],
    queryFn: async (): Promise<PreviewRedeemResponseV2 | undefined> => {
      if (!vault || shares === undefined) return undefined;
      return unwrapResult(await sodax.api.leverageYield.previewRedeem({ vault, shares }, apiConfig));
    },
    enabled: !!vault && vault.length > 0 && shares !== undefined,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
