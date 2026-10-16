import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IntentPacketRequestV2, IntentPacketResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiIntentPacketParams = ReadHookParams<
  IntentPacketResponseV2 | undefined,
  {
    body: IntentPacketRequestV2 | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to long-poll the relayer until the fill packet lands on the destination chain via the
 * leverage-yield API — `sodax.api.leverageYield.getSolvedIntentPacket`.
 *
 * @example
 * const { data } = useLeverageYieldApiIntentPacket({ params: { body: { chainId: 'sonic', fillTxHash: '0x...' } } });
 */
export const useLeverageYieldApiIntentPacket = ({
  params,
  queryOptions,
}: UseLeverageYieldApiIntentPacketParams = {}): UseQueryResult<IntentPacketResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const body = params?.body;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'intentPacket', body?.chainId, body?.fillTxHash],
    queryFn: async (): Promise<IntentPacketResponseV2 | undefined> => {
      if (!body) return undefined;
      return unwrapResult(await sodax.api.leverageYield.getSolvedIntentPacket(body, apiConfig));
    },
    enabled: !!body,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
