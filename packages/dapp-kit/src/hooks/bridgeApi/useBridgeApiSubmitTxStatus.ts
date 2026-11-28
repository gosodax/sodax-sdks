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

/** Polls every 1s until 'executed'/'failed', `abandonedAt`, or API-key rejection (401/403). */
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
      if (!txHash || !srcChainKey) return undefined;
      return unwrapResult(await sodax.api.bridge.getSubmitTxStatus({ txHash, srcChainKey }, apiConfig));
    },
    enabled: !!txHash && txHash.length > 0 && !!srcChainKey,
    retry: retryUnlessAuthFailure,
    refetchInterval: query => getBridgeSubmitTxStatusRefetchInterval(query.state.error, query.state.data?.data),
    ...queryOptions,
  });
};
