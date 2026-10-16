import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { BridgeAllowanceCheckResponseV2, CreateBridgeIntentParamsV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBridgeApiAllowanceParams = ReadHookParams<
  BridgeAllowanceCheckResponseV2 | undefined,
  {
    body: CreateBridgeIntentParamsV2 | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to check whether the source-token allowance is already sufficient for a bridge via
 * the bridge API — `sodax.api.bridge.checkAllowance`. Returns `{ valid }`.
 *
 * The `body` uses the wire DTO field names (`inputToken`/`inputAmount`).
 *
 * @example
 * const { data: allowance } = useBridgeApiAllowance({ params: { body: createBridgeIntentParams } });
 */
export const useBridgeApiAllowance = ({
  params,
  queryOptions,
}: UseBridgeApiAllowanceParams = {}): UseQueryResult<BridgeAllowanceCheckResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const body = params?.body;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['bridgeApi', 'allowance', body?.srcChainKey, body?.inputToken, body?.inputAmount, body?.srcAddress],
    queryFn: async (): Promise<BridgeAllowanceCheckResponseV2 | undefined> => {
      if (!body) return undefined;
      return unwrapResult(await sodax.api.bridge.checkAllowance(body, apiConfig));
    },
    enabled: !!body,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
