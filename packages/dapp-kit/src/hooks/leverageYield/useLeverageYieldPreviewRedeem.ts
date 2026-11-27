import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldPreviewRedeemParams = ReadHookParams<
  bigint,
  { vault: Address | undefined; shares: bigint | undefined }
>;

/** ERC-4626 `previewRedeem`; pass `10n ** 18n` (one share) for the per-share price. */
export function useLeverageYieldPreviewRedeem({
  params,
  queryOptions,
}: UseLeverageYieldPreviewRedeemParams = {}): UseQueryResult<bigint, Error> {
  const { sodax } = useSodaxContext();
  const vault = params?.vault;
  const shares = params?.shares;

  return useQuery<bigint, Error>({
    queryKey: ['leverageYield', 'previewRedeem', vault, shares?.toString()],
    queryFn: async () => {
      if (!vault || shares === undefined) throw new Error('vault and shares are required');
      const result = await sodax.leverageYield.previewRedeem(vault, shares);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!vault && shares !== undefined,
    refetchInterval: 60_000,
    ...queryOptions,
  });
}
