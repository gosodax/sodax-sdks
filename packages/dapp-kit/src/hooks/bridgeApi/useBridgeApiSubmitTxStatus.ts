import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { BridgeSubmitTxStatusResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';
import { getBridgeSubmitTxStatusRefetchInterval } from './getBridgeSubmitTxStatusRefetchInterval.js';

export type UseBridgeApiSubmitTxStatusParams = ReadHookParams<
  BridgeSubmitTxStatusResponseV2 | undefined,
  {
    txHash: string | undefined;
    srcChainKey?: string;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook for polling the processing status of a submitted bridge transaction via the bridge
 * API — `sodax.api.bridge.getSubmitTxStatus`. Both `txHash` and `srcChainKey` are required for the
 * query to run.
 *
 * @example
 * const { data: status } = useBridgeApiSubmitTxStatus({
 *   params: { txHash: '0x123...', srcChainKey: '0xa4b1.arbitrum' },
 * });
 *
 * @remarks
 * - Default refetch interval is 1 second; stops on 'executed' or 'failed' status, when the
 *   backend marks the submission abandoned (`abandonedAt`) while `status` stays non-terminal, or
 *   once the backend rejects the API key (401/403 is terminal — a retry cannot fix it) —
 *   mirroring the SDK's backend submit-tx poll (no solver `posting_execution` state — bridge has
 *   no post-execution).
 */
export const useBridgeApiSubmitTxStatus = ({
  params,
  queryOptions,
}: UseBridgeApiSubmitTxStatusParams = {}): UseQueryResult<BridgeSubmitTxStatusResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const txHash = params?.txHash;
  const srcChainKey = params?.srcChainKey;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['bridgeApi', 'submitTx', 'status', txHash, srcChainKey],
    queryFn: async (): Promise<BridgeSubmitTxStatusResponseV2 | undefined> => {
      // `srcChainKey` is required by the bridge API status query. The `enabled` gate below ensures
      // both are present; this guard also narrows the types for the call.
      if (!txHash || !srcChainKey) return undefined;
      return unwrapResult(await sodax.api.bridge.getSubmitTxStatus({ txHash, srcChainKey }, apiConfig));
    },
    enabled: !!txHash && txHash.length > 0 && !!srcChainKey,
    retry: retryUnlessAuthFailure,
    refetchInterval: query => getBridgeSubmitTxStatusRefetchInterval(query.state.error, query.state.data?.data),
    ...queryOptions,
  });
};
