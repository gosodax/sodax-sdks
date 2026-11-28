import type { FormatReserveUSDResponse, ReserveDataHumanized } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type ReserveUsdFormat = ReserveDataHumanized & FormatReserveUSDResponse;

export type UseReservesUsdFormatParams = ReadHookParams<ReserveUsdFormat[]>;

export function useReservesUsdFormat({
  queryOptions,
}: UseReservesUsdFormatParams = {}): UseQueryResult<ReserveUsdFormat[], Error> {
  const { sodax } = useSodaxContext();

  return useQuery<ReserveUsdFormat[], Error>({
    queryKey: ['mm', 'reservesUsdFormat'],
    queryFn: async () => {
      const reserves = await sodax.moneyMarket.data.getReservesHumanized();
      return sodax.moneyMarket.data.formatReservesUSD(sodax.moneyMarket.data.buildReserveDataWithPrice(reserves));
    },
    ...queryOptions,
  });
}
