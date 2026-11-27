import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { DeadlineQueryV2, DeadlineResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiDeadlineParams = ReadHookParams<
  DeadlineResponseV2,
  {
    query?: DeadlineQueryV2;
    apiConfig?: RequestOverrideConfig;
  }
>;

/** Deadline = hub timestamp + `offsetSeconds` (default 300s). */
export const useLeverageYieldApiDeadline = ({
  params,
  queryOptions,
}: UseLeverageYieldApiDeadlineParams = {}): UseQueryResult<DeadlineResponseV2, Error> => {
  const { sodax } = useSodaxContext();
  const query = params?.query;
  const apiConfig = params?.apiConfig;

  return useQuery<DeadlineResponseV2, Error>({
    queryKey: ['leverageYieldApi', 'deadline', query?.offsetSeconds ?? null],
    queryFn: async (): Promise<DeadlineResponseV2> =>
      unwrapResult(await sodax.api.leverageYield.getDeadline(query, apiConfig)),
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
