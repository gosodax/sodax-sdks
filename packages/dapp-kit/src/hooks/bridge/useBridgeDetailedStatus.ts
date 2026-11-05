import type {
  BridgeDetailedStatusError,
  DetailedBridgeStatus,
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
  getBridgeDetailedStatusRefetchInterval,
  isBridgeMpcRelayRead,
  isBridgeNotDelivered,
} from './getBridgeDetailedStatusRefetchInterval.js';

export type UseBridgeDetailedStatusResult = Result<DetailedBridgeStatus, BridgeDetailedStatusError> | undefined;

export type UseBridgeDetailedStatusParams = ReadHookParams<
  UseBridgeDetailedStatusResult,
  {
    srcChainKey: SpokeChainKey | undefined;
    srcTxHash: string | undefined;
    /** The bridge's destination; from Tron to another spoke the read waits for that leg. */
    dstChainKey?: SpokeChainKey;
    apiConfig?: RequestOverrideConfig;
  }
>;

/** The hub tx a miss is waiting on past, once its first leg has reached the hub. */
function onwardHubTxHash(data: UseBridgeDetailedStatusResult): string | undefined {
  const hubTxHash = data && !data.ok ? data.error.context?.hubTxHash : undefined;
  return typeof hubTxHash === 'string' ? hubTxHash : undefined;
}

/**
 * Hook for monitoring a bridge from its source-chain transaction.
 *
 * `useBridgeApiSubmitTxStatus` needs the backend to still hold a usable record; this takes
 * `(srcChainKey, srcTxHash)` — the pair you hold after `bridge()`, plus `dstChainKey` for a bridge from Tron —
 * and routes to whichever source
 * can answer, so it also covers a bridge the client-side fallback completed. `data.value` is
 * discriminated on `source`, and each variant carries that source's payload unmodified.
 *
 * Polls every 3s. Stops once the answering source is terminal (a relay packet always is), once the
 * backend rejects the API key, and — like `useDetailedStatus` — after 40 consecutive *ambiguous*
 * reads, meaning a `LOOKUP_FAILED` whose relay has no packet for the tx — 100, about 5 minutes, for a bridge
 * with an MPC-relay end (`context.mpcRelay`), which settles more slowly. A dependency outage keeps
 * polling instead, so the read recovers by itself; any real answer resets the budget. Override with
 * `queryOptions.refetchInterval`.
 *
 * @example
 * ```typescript
 * const { data } = useBridgeDetailedStatus({ params: { srcChainKey, srcTxHash, dstChainKey } });
 * if (data?.ok && data.value.source === 'relay') console.log(data.value.data.dst_tx_hash);
 * ```
 */

export const useBridgeDetailedStatus = ({
  params,
  queryOptions,
}: UseBridgeDetailedStatusParams = {}): UseQueryResult<UseBridgeDetailedStatusResult> => {
  const { sodax } = useSodaxContext();
  const srcChainKey = params?.srcChainKey;
  const srcTxHash = params?.srcTxHash;
  const dstChainKey = params?.dstChainKey;
  const apiConfig = params?.apiConfig;
  // Composite identity: a new bridge must start its own not-delivered budget.
  const pollKey = srcChainKey && srcTxHash ? `${srcChainKey}:${srcTxHash}:${dstChainKey ?? ''}` : undefined;
  const notFoundStreakRef = useRef({ ...INITIAL_NOT_FOUND_STREAK });

  return useQuery({
    queryKey: ['bridge', 'detailedStatus', srcChainKey, srcTxHash, ...(dstChainKey ? [dstChainKey] : [])],
    queryFn: async () => {
      if (!srcChainKey || !srcTxHash) return undefined;
      return sodax.bridge.getDetailedStatus({ srcChainKey, srcTxHash, dstChainKey }, apiConfig);
    },
    enabled: !!srcChainKey && !!srcTxHash,
    refetchInterval: query => {
      // Reaching the hub is progress, so the leg after it gets a budget of its own. An MPC-relay miss counts
      // on its own streak too, so one untagged miss in between cannot cut its longer budget short.
      const { data } = query.state;
      const leg = [onwardHubTxHash(data), isBridgeMpcRelayRead(data) ? 'mpcRelay' : undefined].filter(Boolean);
      notFoundStreakRef.current = advanceNotFoundStreak(
        notFoundStreakRef.current,
        pollKey && [pollKey, ...leg].join(':'),
        isBridgeNotDelivered(data),
        query.state.dataUpdateCount,
      );
      return getBridgeDetailedStatusRefetchInterval(data, notFoundStreakRef.current.consecutiveNotFound);
    },
    ...queryOptions,
  });
};
