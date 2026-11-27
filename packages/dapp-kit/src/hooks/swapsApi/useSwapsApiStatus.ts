import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { isAuthFailure, type RequestOverrideConfig, type StatusResponseV2 } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';
import { isTerminalSwapIntentStatus } from './isTerminalSwapIntentStatus.js';

export type UseSwapsApiStatusParams = ReadHookParams<
  StatusResponseV2 | undefined,
  {
    intentTxHash: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/** Polls every 1s until SOLVED (3), FAILED (4) or an API-key rejection (401/403). */
export const useSwapsApiStatus = ({
  params,
  queryOptions,
}: UseSwapsApiStatusParams = {}): UseQueryResult<StatusResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const intentTxHash = params?.intentTxHash;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['swapsApi', 'status', intentTxHash],
    queryFn: async (): Promise<StatusResponseV2 | undefined> => {
      if (!intentTxHash) return undefined;
      return unwrapResult(await sodax.api.swaps.getStatus({ intentTxHash }, apiConfig));
    },
    enabled: !!intentTxHash && intentTxHash.length > 0,
    retry: retryUnlessAuthFailure,
    refetchInterval: query => {
      // `retry` bounds attempts within a tick, not the interval itself — so stop it here too.
      if (isAuthFailure(query.state.error)) return false;
      return isTerminalSwapIntentStatus(query.state.data?.status) ? false : 1000;
    },
    ...queryOptions,
  });
};
