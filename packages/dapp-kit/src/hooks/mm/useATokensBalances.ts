import type { SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { type Address, isAddress } from 'viem';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { resolveBtcReadAddress } from '../bitcoin/resolveBtcReadAddress.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseATokensBalancesParams = ReadHookParams<
  Map<Address, bigint>,
  {
    aTokens: readonly Address[];
    spokeChainKey: SpokeChainKey | undefined;
    userAddress: string | undefined;
  }
>;

export function useATokensBalances({
  params,
  queryOptions,
}: UseATokensBalancesParams = {}): UseQueryResult<Map<Address, bigint>, Error> {
  const { sodax } = useSodaxContext();
  const aTokens = params?.aTokens ?? [];
  const spokeChainKey = params?.spokeChainKey;
  const userAddress = params?.userAddress;

  return useQuery({
    queryKey: ['mm', 'aTokensBalances', aTokens, spokeChainKey, userAddress],
    queryFn: async () => {
      if (aTokens.length === 0) {
        return new Map<Address, bigint>();
      }
      if (!spokeChainKey || !userAddress) {
        throw new Error('spokeChainKey and userAddress are required');
      }
      for (const aToken of aTokens) {
        if (!isAddress(aToken)) {
          throw new Error(`Invalid aToken address: ${aToken}`);
        }
      }

      // Bitcoin positions live under the trading-wallet-derived hub wallet; resolve it locally
      // (no network) so a Bound Exchange outage never reads a real position as empty.
      const hubWalletAddress = await sodax.hubProvider.getUserHubWalletAddress(
        resolveBtcReadAddress(spokeChainKey, userAddress),
        spokeChainKey,
      );
      return sodax.moneyMarket.data.getATokensBalances(aTokens, hubWalletAddress);
    },
    enabled: aTokens.length > 0 && !!spokeChainKey && !!userAddress,
    ...queryOptions,
  });
}
