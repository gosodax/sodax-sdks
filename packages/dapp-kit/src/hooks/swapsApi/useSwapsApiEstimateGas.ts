import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { GasEstimateRequestV2, GasEstimateResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseSwapsApiEstimateGasParams = ReadHookParams<
  GasEstimateResponseV2 | undefined,
  {
    body: GasEstimateRequestV2 | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to estimate gas for a raw transaction on a spoke chain via the swaps API —
 * `sodax.api.swaps.estimateGas`. Returns `{ gas }` (chain-specific shape).
 *
 * @example
 * const { data } = useSwapsApiEstimateGas({ params: { body: { chainKey: 'sonic', tx } } });
 */
export const useSwapsApiEstimateGas = ({
  params,
  queryOptions,
}: UseSwapsApiEstimateGasParams = {}): UseQueryResult<GasEstimateResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const body = params?.body;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['swapsApi', 'estimateGas', body?.chainKey, body?.tx],
    queryFn: async (): Promise<GasEstimateResponseV2 | undefined> => {
      if (!body) return undefined;
      return unwrapResult(await sodax.api.swaps.estimateGas(body, apiConfig));
    },
    enabled: !!body,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
