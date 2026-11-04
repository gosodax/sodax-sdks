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

/**
 * React hook to fetch the deposit capacity / withdrawal liquidity limit for a (from, to) token pair
 * via the bridge API — `sodax.api.bridge.getBridgeableAmount`. Returns `{ limit }`.
 *
 * Computable client-side from config + vault reserves — prefer `sodax.bridge.getBridgeableAmount`
 * for a no-round-trip read; this HTTP variant mirrors the `/bridge/bridgeable-amount` endpoint.
 *
 * The `body` uses the wire DTO field names (`srcChainKey`/`dstChainKey`/`inputToken`/`outputToken`).
 *
 * @example
 * const { data } = useBridgeApiBridgeableAmount({ params: { body: quote } });
 */
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
