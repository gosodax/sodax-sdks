import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldTotalAssetsParams = ReadHookParams<bigint, { vault: Address | undefined }>;

/** Vault TVL in vault-asset units (18 decimals). */
export function useLeverageYieldTotalAssets({
  params,
  queryOptions,
}: UseLeverageYieldTotalAssetsParams = {}): UseQueryResult<bigint, Error> {
  const { sodax } = useSodaxContext();
  const vault = params?.vault;

  return useQuery<bigint, Error>({
    queryKey: ['leverageYield', 'totalAssets', vault],
    queryFn: async () => {
      if (!vault) throw new Error('vault is required');
      const result = await sodax.leverageYield.getTotalAssets(vault);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!vault,
    refetchInterval: 60_000,
    ...queryOptions,
  });
}
