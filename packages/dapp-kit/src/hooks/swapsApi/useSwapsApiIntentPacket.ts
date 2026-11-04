import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IntentPacketRequestV2, IntentPacketResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseSwapsApiIntentPacketParams = ReadHookParams<
  IntentPacketResponseV2 | undefined,
  {
    body: IntentPacketRequestV2 | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to long-poll the relayer until the fill packet lands on the destination chain via the
 * swaps API — `sodax.api.swaps.getSolvedIntentPacket`. The request is held open server-side until
 * the packet arrives (or `body.timeout` ms elapses), so no client-side `refetchInterval` is set.
 *
 * @example
 * const { data: packet } = useSwapsApiIntentPacket({
 *   params: { body: { chainId: '146', fillTxHash: '0x123...' } },
 * });
 */
export const useSwapsApiIntentPacket = ({
  params,
  queryOptions,
}: UseSwapsApiIntentPacketParams = {}): UseQueryResult<IntentPacketResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const body = params?.body;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['swapsApi', 'intentPacket', body?.chainId, body?.fillTxHash],
    queryFn: async (): Promise<IntentPacketResponseV2 | undefined> => {
      if (!body) return undefined;
      return unwrapResult(await sodax.api.swaps.getSolvedIntentPacket(body, apiConfig));
    },
    enabled: !!body,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
