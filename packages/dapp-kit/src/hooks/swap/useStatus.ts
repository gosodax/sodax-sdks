import type { Hex, SolverErrorResponse, SolverIntentStatusResponse } from '@sodax/sdk';
import type { Result } from '@sodax/sdk';
import { useRef } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';
import { advanceNotFoundStreak, INITIAL_NOT_FOUND_STREAK } from '../shared/notFoundStreak.js';
import { getSolverStatusRefetchInterval, isSolverNotFound } from '../shared/solverStatusPolicy.js';

export type UseStatusParams = ReadHookParams<
  Result<SolverIntentStatusResponse, SolverErrorResponse> | undefined,
  { intentTxHash: Hex | undefined }
>;

/**
 * Polls every 3s; stops on `SOLVED`/`FAILED` or after 40 consecutive `NOT_FOUND` reads (~2 min).
 * An in-flight status resets that streak.
 */
export const useStatus = ({
  params,
  queryOptions,
}: UseStatusParams = {}): UseQueryResult<Result<SolverIntentStatusResponse, SolverErrorResponse> | undefined> => {
  const { sodax } = useSodaxContext();
  const intentTxHash = params?.intentTxHash;
  const notFoundStreakRef = useRef({ ...INITIAL_NOT_FOUND_STREAK });

  return useQuery({
    queryKey: ['swap', 'status', intentTxHash],
    queryFn: async () => {
      if (!intentTxHash) return undefined;
      return sodax.swaps.getStatus({ intent_tx_hash: intentTxHash });
    },
    enabled: !!intentTxHash,
    refetchInterval: query => {
      notFoundStreakRef.current = advanceNotFoundStreak(
        notFoundStreakRef.current,
        intentTxHash,
        isSolverNotFound(query.state.data),
        query.state.dataUpdateCount,
      );
      return getSolverStatusRefetchInterval(query.state.data, notFoundStreakRef.current.consecutiveNotFound);
    },
    ...queryOptions,
  });
};
