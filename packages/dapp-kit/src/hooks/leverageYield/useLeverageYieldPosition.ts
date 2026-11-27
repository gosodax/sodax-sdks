import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address, LeverageYieldPosition } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldPositionParams = ReadHookParams<LeverageYieldPosition, { vault: Address | undefined }>;

/** Vault position snapshot (`getPositionDetails`); health factor is ∞ when there is no debt. */
export function useLeverageYieldPosition({
  params,
  queryOptions,
}: UseLeverageYieldPositionParams = {}): UseQueryResult<LeverageYieldPosition, Error> {
  const { sodax } = useSodaxContext();
  const vault = params?.vault;

  return useQuery<LeverageYieldPosition, Error>({
    queryKey: ['leverageYield', 'position', vault],
    queryFn: async () => {
      if (!vault) throw new Error('vault is required');
      const result = await sodax.leverageYield.getPosition(vault);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!vault,
    refetchInterval: 30_000,
    ...queryOptions,
  });
}
