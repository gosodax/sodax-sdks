import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { BridgeFeeRequestV2, BridgeFeeResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBridgeApiFeeParams = ReadHookParams<
  BridgeFeeResponseV2 | undefined,
  {
    body: BridgeFeeRequestV2 | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to fetch the bridge partner fee for an input amount via the bridge API (uses a per-request
 * `body.partnerFee` override when supplied, else the backend-configured fee) —
 * `sodax.api.bridge.getFee`. Returns `{ fee }` (smallest unit, decimal string).
 *
 * The fee is computable client-side (config-driven, token-independent) — prefer `sodax.bridge.getFee`
 * for a no-round-trip read; this HTTP variant mirrors the `/bridge/fee` endpoint for parity.
 *
 * @example
 * const { data: fee } = useBridgeApiFee({ params: { body: { inputAmount } } });
 */
export const useBridgeApiFee = ({
  params,
  queryOptions,
}: UseBridgeApiFeeParams = {}): UseQueryResult<BridgeFeeResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const body = params?.body;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['bridgeApi', 'fee', body?.inputAmount, body?.partnerFee],
    queryFn: async (): Promise<BridgeFeeResponseV2 | undefined> => {
      if (!body) return undefined;
      return unwrapResult(await sodax.api.bridge.getFee(body, apiConfig));
    },
    enabled: !!body,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
