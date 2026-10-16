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

/**
 * React hook to check whether a (from, to) token pair is bridgeable via the bridge API —
 * `sodax.api.bridge.isBridgeable`. Returns `{ bridgeable }`.
 *
 * Computable client-side from config + vault reserves — prefer `sodax.bridge.isBridgeable`
 * for a no-round-trip read; this HTTP variant mirrors the `/bridge/bridgeable/check` endpoint.
 *
 * The `body` uses the wire DTO field names (`srcChainKey`/`dstChainKey`/`inputToken`/`outputToken`).
 *
 * @example
 * const { data } = useBridgeApiIsBridgeable({ params: { body: quote } });
 */
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
