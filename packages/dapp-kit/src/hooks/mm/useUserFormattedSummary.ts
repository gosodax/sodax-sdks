import type { FormatReserveUSDResponse, FormatUserSummaryResponse } from '@sodax/sdk';
import type { SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { resolveBtcReadAddress } from '../bitcoin/resolveBtcReadAddress.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseUserFormattedSummaryParams = ReadHookParams<
  FormatUserSummaryResponse<FormatReserveUSDResponse>,
  {
    spokeChainKey: SpokeChainKey | undefined;
    userAddress: string | undefined;
  }
>;

export function useUserFormattedSummary({
  params,
  queryOptions,
}: UseUserFormattedSummaryParams = {}): UseQueryResult<FormatUserSummaryResponse<FormatReserveUSDResponse>, Error> {
  const { sodax } = useSodaxContext();
  const spokeChainKey = params?.spokeChainKey;
  const userAddress = params?.userAddress;

  return useQuery({
    queryKey: ['mm', 'userFormattedSummary', spokeChainKey, userAddress],
    queryFn: async () => {
      if (!spokeChainKey || !userAddress) {
        throw new Error('spokeChainKey and userAddress are required');
      }

      const [reserves, userReserves] = await Promise.all([
        sodax.moneyMarket.data.getReservesHumanized(),
        sodax.moneyMarket.data.getUserReservesHumanized(
          spokeChainKey,
          resolveBtcReadAddress(spokeChainKey, userAddress),
        ),
      ]);
      const formattedReserves = sodax.moneyMarket.data.formatReservesUSD(
        sodax.moneyMarket.data.buildReserveDataWithPrice(reserves),
      );

      return sodax.moneyMarket.data.formatUserSummary(
        sodax.moneyMarket.data.buildUserSummaryRequest(reserves, formattedReserves, userReserves),
      );
    },
    enabled: !!spokeChainKey && !!userAddress,
    refetchInterval: 5000,
    ...queryOptions,
  });
}
