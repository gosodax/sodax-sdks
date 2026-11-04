import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { EmodeDataHumanized } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseEModesParams = ReadHookParams<EmodeDataHumanized[]>;

/**
 * Reads the pool's configured eMode categories — LTV, liquidation threshold and bonus in basis
 * points, plus the collateral/borrowable bitmaps and label.
 *
 * A category's LTV replaces the reserve's own when a user opts into it, so anything projecting
 * borrowing power for an eMode position must read it from here rather than from the reserve.
 * Categories only change by governance, so this is not polled.
 *
 * @example
 * ```typescript
 * const { data: categories } = useEModes();
 * const cat = categories?.find(c => Number(c.id) === selected);
 * const ltv = Number(cat?.eMode.ltv ?? 0) / 10_000;
 * ```
 */
export function useEModes({ queryOptions }: UseEModesParams = {}): UseQueryResult<EmodeDataHumanized[], Error> {
  const { sodax } = useSodaxContext();

  return useQuery<EmodeDataHumanized[], Error>({
    queryKey: ['moneyMarket', 'eModes'],
    queryFn: () => sodax.moneyMarket.data.getEModesHumanized(),
    ...queryOptions,
  });
}
