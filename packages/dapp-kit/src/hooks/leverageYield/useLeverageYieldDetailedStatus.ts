import type {
  DetailedLeverageYieldStatus,
  LeverageYieldDetailedStatusError,
  RequestOverrideConfig,
  Result,
  SpokeChainKey,
} from '@sodax/sdk';
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

export type UseLeverageYieldDetailedStatusResult =
  | Result<DetailedLeverageYieldStatus, LeverageYieldDetailedStatusError>
  | undefined;

export type UseLeverageYieldDetailedStatusParams = ReadHookParams<
  UseLeverageYieldDetailedStatusResult,
  {
    srcChainKey: SpokeChainKey | undefined;
    srcTxHash: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * Vault-swap status from `(srcChainKey, srcTxHash)`, routed to whichever source can answer. Polls until terminal,
 * auth rejection, or 40 consecutive ambiguous reads (solver NOT_FOUND / relay not delivered); outages keep polling.
 */
export const useLeverageYieldDetailedStatus = ({
  params,
  queryOptions,
}: UseLeverageYieldDetailedStatusParams = {}): UseQueryResult<UseLeverageYieldDetailedStatusResult> => {
  const { sodax } = useSodaxContext();
  const srcChainKey = params?.srcChainKey;
  const srcTxHash = params?.srcTxHash;
  const apiConfig = params?.apiConfig;
  // Composite identity: a new vault swap must start its own NOT_FOUND budget.
  const pollKey = srcChainKey && srcTxHash ? `${srcChainKey}:${srcTxHash}` : undefined;
  const notFoundStreakRef = useRef({ ...INITIAL_NOT_FOUND_STREAK });

  return useQuery({
    queryKey: ['leverageYield', 'detailedStatus', srcChainKey, srcTxHash],
    queryFn: async () => {
      if (!srcChainKey || !srcTxHash) return undefined;
      return sodax.leverageYield.getDetailedStatus({ srcChainKey, srcTxHash }, apiConfig);
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
