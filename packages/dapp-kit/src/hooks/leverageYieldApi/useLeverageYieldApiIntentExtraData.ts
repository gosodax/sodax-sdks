import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IntentExtraDataRequestV2, IntentExtraDataResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiIntentExtraDataParams = ReadHookParams<
  IntentExtraDataResponseV2 | undefined,
  {
    body: IntentExtraDataRequestV2 | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to recover the relay extra data needed by `/leverage-yield/intents/submit` via the
 * leverage-yield API — `sodax.api.leverageYield.getIntentSubmitTxExtraData`. Provide EITHER `txHash`
 * OR `intent` in the body.
 *
 * @example
 * const { data } = useLeverageYieldApiIntentExtraData({ params: { body: { txHash: '0x...' } } });
 */
export const useLeverageYieldApiIntentExtraData = ({
  params,
  queryOptions,
}: UseLeverageYieldApiIntentExtraDataParams = {}): UseQueryResult<IntentExtraDataResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const body = params?.body;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'intentExtraData', body?.txHash ?? body?.intent?.intentId?.toString()],
    queryFn: async (): Promise<IntentExtraDataResponseV2 | undefined> => {
      if (!body || (!body.txHash && !body.intent)) return undefined;
      return unwrapResult(await sodax.api.leverageYield.getIntentSubmitTxExtraData(body, apiConfig));
    },
    enabled: !!body && (!!body.txHash || !!body.intent),
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
