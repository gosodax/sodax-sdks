import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IntentExtraDataRequestV2, IntentExtraDataResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseSwapsApiIntentExtraDataParams = ReadHookParams<
  IntentExtraDataResponseV2 | undefined,
  {
    body: IntentExtraDataRequestV2 | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to recover the relay extra data needed by `/swaps/intents/submit` via the swaps API —
 * `sodax.api.swaps.getIntentSubmitTxExtraData`. Provide EITHER `txHash` OR `intent` in the body
 * (whose `bigint` numerics are serialized by the SDK). Returns `{ address, payload }`.
 *
 * @example
 * const { data } = useSwapsApiIntentExtraData({ params: { body: { txHash: '0x123...' } } });
 */
export const useSwapsApiIntentExtraData = ({
  params,
  queryOptions,
}: UseSwapsApiIntentExtraDataParams = {}): UseQueryResult<IntentExtraDataResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const body = params?.body;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['swapsApi', 'intentExtraData', body?.txHash ?? body?.intent?.intentId?.toString()],
    queryFn: async (): Promise<IntentExtraDataResponseV2 | undefined> => {
      if (!body || (!body.txHash && !body.intent)) return undefined;
      return unwrapResult(await sodax.api.swaps.getIntentSubmitTxExtraData(body, apiConfig));
    },
    enabled: !!body && (!!body.txHash || !!body.intent),
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
