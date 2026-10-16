import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { isAuthFailure, type RequestOverrideConfig, type SubmitTxStatusResponseV2 } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseSwapsApiSubmitTxStatusParams = ReadHookParams<
  SubmitTxStatusResponseV2 | undefined,
  {
    txHash: string | undefined;
    srcChainKey?: string;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook for polling the processing status of a submitted swap transaction via the swaps API —
 * `sodax.api.swaps.getSubmitTxStatus`. Both `txHash` and `srcChainKey` are required for the query
 * to run (the swaps API status query requires the source chain key).
 *
 * @example
 * const { data: status } = useSwapsApiSubmitTxStatus({
 *   params: { txHash: '0x123...', srcChainKey: 'sonic' },
 * });
 *
 * @remarks
 * - Default refetch interval is 1 second; stops on 'solved' or 'failed' status, when the
 *   backend marks the submission abandoned (`abandonedAt`) while `status` stays non-terminal, or
 *   once the backend rejects the API key (401/403 is terminal — a retry cannot fix it).
 */
export const useSwapsApiSubmitTxStatus = ({
  params,
  queryOptions,
}: UseSwapsApiSubmitTxStatusParams = {}): UseQueryResult<SubmitTxStatusResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const txHash = params?.txHash;
  const srcChainKey = params?.srcChainKey;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['swapsApi', 'submitTx', 'status', txHash, srcChainKey],
    queryFn: async (): Promise<SubmitTxStatusResponseV2 | undefined> => {
      // `srcChainKey` is required by the swaps API status query. The `enabled` gate below
      // ensures both are present; this guard also narrows the types for the call.
      if (!txHash || !srcChainKey) return undefined;
      return unwrapResult(await sodax.api.swaps.getSubmitTxStatus({ txHash, srcChainKey }, apiConfig));
    },
    enabled: !!txHash && txHash.length > 0 && !!srcChainKey,
    retry: retryUnlessAuthFailure,
    refetchInterval: query => {
      // `retry` bounds attempts within a tick, not the interval itself — so stop it here too.
      if (isAuthFailure(query.state.error)) return false;
      const data = query.state.data?.data;
      // `abandonedAt` is terminal even when `status` is still non-terminal — same rule as the
      // SDK's pollBackendSubmitTx and the bridge-api status hook.
      if (data?.status === 'solved' || data?.status === 'failed' || data?.abandonedAt) return false;
      return 1000;
    },
    ...queryOptions,
  });
};
