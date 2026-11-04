import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { DeadlineQueryV2, DeadlineResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseSwapsApiDeadlineParams = ReadHookParams<
  DeadlineResponseV2,
  {
    query?: DeadlineQueryV2;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to compute a swap deadline (hub timestamp + `offsetSeconds`, default 300s) via the
 * swaps API — `sodax.api.swaps.getDeadline`.
 *
 * @example
 * const { data: deadline } = useSwapsApiDeadline({ params: { query: { offsetSeconds: 600 } } });
 */
export const useSwapsApiDeadline = ({
  params,
  queryOptions,
}: UseSwapsApiDeadlineParams = {}): UseQueryResult<DeadlineResponseV2, Error> => {
  const { sodax } = useSodaxContext();
  const query = params?.query;
  const apiConfig = params?.apiConfig;

  return useQuery<DeadlineResponseV2, Error>({
    queryKey: ['swapsApi', 'deadline', query?.offsetSeconds ?? null],
    queryFn: async (): Promise<DeadlineResponseV2> => unwrapResult(await sodax.api.swaps.getDeadline(query, apiConfig)),
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
