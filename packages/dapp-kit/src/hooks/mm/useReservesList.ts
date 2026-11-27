import type { Address } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseReservesListParams = ReadHookParams<readonly Address[]>;

export function useReservesList({
  queryOptions,
}: UseReservesListParams = {}): UseQueryResult<readonly Address[], Error> {
  const { sodax } = useSodaxContext();

  return useQuery<readonly Address[], Error>({
    queryKey: ['mm', 'reservesList'],
    queryFn: async () => sodax.moneyMarket.data.getReservesList(),
    ...queryOptions,
  });
}
