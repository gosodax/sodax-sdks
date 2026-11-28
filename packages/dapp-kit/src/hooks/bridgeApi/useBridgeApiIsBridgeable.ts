import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { BridgeableCheckResponseV2, BridgeQuoteRequestV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBridgeApiIsBridgeableParams = ReadHookParams<
  BridgeableCheckResponseV2 | undefined,
  {
    body: BridgeQuoteRequestV2 | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/** HTTP mirror of `sodax.bridge.isBridgeable` (prefer that for a no-round-trip read); `body` uses wire DTO field names. */
export const useBridgeApiIsBridgeable = ({
  params,
  queryOptions,
}: UseBridgeApiIsBridgeableParams = {}): UseQueryResult<BridgeableCheckResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const body = params?.body;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['bridgeApi', 'bridgeable', body?.srcChainKey, body?.dstChainKey, body?.inputToken, body?.outputToken],
    queryFn: async (): Promise<BridgeableCheckResponseV2 | undefined> => {
      if (!body) return undefined;
      return unwrapResult(await sodax.api.bridge.isBridgeable(body, apiConfig));
    },
    enabled: !!body,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
