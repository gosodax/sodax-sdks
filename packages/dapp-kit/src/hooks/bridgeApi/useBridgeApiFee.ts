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

/** Uses `body.partnerFee` when supplied, else the backend-configured fee; `fee` is a smallest-unit decimal string.
 * Prefer `sodax.bridge.getFee` for a no-round-trip read. */
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
