import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { BridgeableAmountResponseV2, BridgeQuoteRequestV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBridgeApiBridgeableAmountParams = ReadHookParams<
  BridgeableAmountResponseV2 | undefined,
  {
    body: BridgeQuoteRequestV2 | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/** HTTP mirror of `sodax.bridge.getBridgeableAmount` (prefer that for a no-round-trip read); `body` uses wire DTO field names. */
export const useBridgeApiBridgeableAmount = ({
  params,
  queryOptions,
}: UseBridgeApiBridgeableAmountParams = {}): UseQueryResult<BridgeableAmountResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const body = params?.body;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['bridgeApi', 'bridgeableAmount', body?.srcChainKey, body?.dstChainKey, body?.inputToken, body?.outputToken],
    queryFn: async (): Promise<BridgeableAmountResponseV2 | undefined> => {
      if (!body) return undefined;
      return unwrapResult(await sodax.api.bridge.getBridgeableAmount(body, apiConfig));
    },
    enabled: !!body,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
