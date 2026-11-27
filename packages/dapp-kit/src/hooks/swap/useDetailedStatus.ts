import type { DetailedStatusError, DetailedSwapStatus, Result, SpokeChainKey } from '@sodax/sdk';
import { useRef } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';
import { advanceNotFoundStreak, INITIAL_NOT_FOUND_STREAK } from '../shared/notFoundStreak.js';
import {
  getSolverDetailedStatusRefetchInterval,
  isSolverNotFound,
  toNotFoundBudgetRead,
} from '../shared/solverStatusPolicy.js';

export type UseDetailedStatusResult = Result<DetailedSwapStatus, DetailedStatusError> | undefined;

export type UseDetailedStatusParams = ReadHookParams<
  UseDetailedStatusResult,
  { srcChainKey: SpokeChainKey | undefined; srcTxHash: string | undefined }
>;

/**
 * Status by source tx `(srcChainKey, srcTxHash)`, routed to whichever source can answer; `data.value` is discriminated on `source`.
 * Polls every 3s until terminal, API-key rejection, or 40 consecutive ambiguous reads (solver NOT_FOUND / no relay packet); outages keep polling.
 */
export const useDetailedStatus = ({
  params,
  queryOptions,
}: UseDetailedStatusParams = {}): UseQueryResult<UseDetailedStatusResult> => {
  const { sodax } = useSodaxContext();
  const srcChainKey = params?.srcChainKey;
  const srcTxHash = params?.srcTxHash;
  // Composite identity: a new swap must start its own NOT_FOUND budget.
  const pollKey = srcChainKey && srcTxHash ? `${srcChainKey}:${srcTxHash}` : undefined;
  const notFoundStreakRef = useRef({ ...INITIAL_NOT_FOUND_STREAK });

  return useQuery({
    queryKey: ['swap', 'detailedStatus', srcChainKey, srcTxHash],
    queryFn: async () => {
      if (!srcChainKey || !srcTxHash) return undefined;
      return sodax.swaps.getDetailedStatus({ srcChainKey, srcTxHash });
    },
    enabled: !!srcChainKey && !!srcTxHash,
    refetchInterval: query => {
      notFoundStreakRef.current = advanceNotFoundStreak(
        notFoundStreakRef.current,
        pollKey,
        isSolverNotFound(toNotFoundBudgetRead(query.state.data)),
        query.state.dataUpdateCount,
      );
      return getSolverDetailedStatusRefetchInterval(query.state.data, notFoundStreakRef.current.consecutiveNotFound);
    },
    ...queryOptions,
  });
};
