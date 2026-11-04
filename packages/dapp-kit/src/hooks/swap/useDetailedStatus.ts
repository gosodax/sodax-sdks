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
 * Hook for monitoring a swap from its source-chain transaction.
 *
 * `useStatus` needs the hub tx hash and always asks the solver; this takes `(srcChainKey,
 * srcTxHash)` — the pair you hold after `swap()` — and routes to whichever source can answer.
 * `data.value` is discriminated on `source`, and each variant carries that source's payload
 * unmodified.
 *
 * Polls every 3s. Stops once the answering source is terminal, once the backend rejects the API
 * key, and — like `useStatus` — after 40 consecutive *ambiguous* reads: a solver `NOT_FOUND`, or a
 * `LOOKUP_FAILED` whose relay has no packet for the tx. Neither can distinguish "still in flight" from "never will be", so the budget
 * is what stops a swap nothing can resolve. A dependency outage — relay unreachable, solver down —
 * keeps polling instead, so the read recovers by itself; any real status resets the budget.
 * Override with `queryOptions.refetchInterval`.
 *
 * @example
 * ```typescript
 * const { data } = useDetailedStatus({ params: { srcChainKey, srcTxHash } });
 * if (data?.ok && data.value.source === 'backend') console.log(data.value.data.status);
 * ```
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
