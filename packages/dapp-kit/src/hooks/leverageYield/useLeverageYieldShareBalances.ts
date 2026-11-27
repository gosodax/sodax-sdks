import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { Address, SpokeChainKey } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type LeverageYieldShareHolding = {
  chainKey: SpokeChainKey;
  holder: Address;
  shares: bigint;
};

export type LeverageYieldShareHolder = {
  chainKey: SpokeChainKey;
  address: string;
};

export type UseLeverageYieldShareBalancesParams = ReadHookParams<
  LeverageYieldShareHolding,
  { vault: Address | undefined; holders: readonly LeverageYieldShareHolder[] | undefined }
>;

/** One `lsoda*` share-balance query per `(chainKey, EOA)` holder; `queryOptions` applies to each query. */
export function useLeverageYieldShareBalances({
  params,
  queryOptions,
}: UseLeverageYieldShareBalancesParams = {}): UseQueryResult<LeverageYieldShareHolding, Error>[] {
  const { sodax } = useSodaxContext();
  const vault = params?.vault;
  const holders = params?.holders;

  return useQueries({
    queries: (holders ?? []).map(({ chainKey, address }) => ({
      queryKey: ['leverageYield', 'shareBalance', vault, chainKey, address] as const,
      refetchInterval: 15_000,
      ...queryOptions,
      enabled: !!vault,
      queryFn: async (): Promise<LeverageYieldShareHolding> => {
        if (!vault) throw new Error('vault is required');
        // Hub wallet even on the hub chain: deposits deliver shares there, never to the EOA.
        const holder = await sodax.hubProvider.getUserHubWalletAddress(address, chainKey);
        const result = await sodax.leverageYield.getShareBalance(vault, holder);
        if (!result.ok) throw result.error;
        return { chainKey, holder, shares: result.value };
      },
    })),
  });
}
