import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address, LeverageYieldEffectiveApr } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldEffectiveAprParams = ReadHookParams<
  LeverageYieldEffectiveApr,
  { vault: Address | undefined }
>;

/** Vault APR: AAVE supply/borrow rates plus LSD staking yield, with the vault's leverage applied. */
export function useLeverageYieldEffectiveApr({
  params,
  queryOptions,
}: UseLeverageYieldEffectiveAprParams = {}): UseQueryResult<LeverageYieldEffectiveApr, Error> {
  const { sodax } = useSodaxContext();
  const vault = params?.vault;

  return useQuery<LeverageYieldEffectiveApr, Error>({
    queryKey: ['leverageYield', 'effectiveApr', vault],
    queryFn: async () => {
      if (!vault) throw new Error('vault is required');
      const result = await sodax.leverageYield.getEffectiveApr(vault);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!vault,
    refetchInterval: 60_000,
    ...queryOptions,
  });
}
