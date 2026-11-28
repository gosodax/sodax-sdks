import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { EmodeDataHumanized } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseEModesParams = ReadHookParams<EmodeDataHumanized[]>;

/**
 * A category's LTV replaces the reserve's own when a user opts in, so eMode borrow-power projections
 * must read it from here. Categories change only by governance, so this is not polled.
 */
export function useEModes({ queryOptions }: UseEModesParams = {}): UseQueryResult<EmodeDataHumanized[], Error> {
  const { sodax } = useSodaxContext();

  return useQuery<EmodeDataHumanized[], Error>({
    queryKey: ['moneyMarket', 'eModes'],
    queryFn: () => sodax.moneyMarket.data.getEModesHumanized(),
    ...queryOptions,
  });
}
