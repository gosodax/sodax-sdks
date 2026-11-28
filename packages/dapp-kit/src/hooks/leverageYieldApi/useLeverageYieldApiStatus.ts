import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { RequestOverrideConfig, StatusResponseV2 } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';
// Leverage-yield intents share the solver status codes with swaps.
import { isTerminalSwapIntentStatus } from '../swapsApi/isTerminalSwapIntentStatus.js';

export type UseLeverageYieldApiStatusParams = ReadHookParams<
  StatusResponseV2 | undefined,
  {
    intentTxHash: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/** Polls every 1s until `status` is 3 (SOLVED) or 4 (FAILED). */
export const useLeverageYieldApiStatus = ({
  params,
  queryOptions,
}: UseLeverageYieldApiStatusParams = {}): UseQueryResult<StatusResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const intentTxHash = params?.intentTxHash;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'status', intentTxHash],
    queryFn: async (): Promise<StatusResponseV2 | undefined> => {
      if (!intentTxHash) return undefined;
      return unwrapResult(await sodax.api.leverageYield.getStatus({ intentTxHash }, apiConfig));
    },
    enabled: !!intentTxHash && intentTxHash.length > 0,
    retry: retryUnlessAuthFailure,
    refetchInterval: query => (isTerminalSwapIntentStatus(query.state.data?.status) ? false : 1000),
    ...queryOptions,
  });
};
