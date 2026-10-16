import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { FeeResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseSwapsApiPartnerFeeParams = ReadHookParams<
  FeeResponseV2 | undefined,
  {
    amount: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to compute the partner fee for a given input amount via the swaps API —
 * `sodax.api.swaps.getPartnerFee`. Returns `{ fee }` (decimal string).
 *
 * @example
 * const { data } = useSwapsApiPartnerFee({ params: { amount: '1000000' } });
 */
export const useSwapsApiPartnerFee = ({
  params,
  queryOptions,
}: UseSwapsApiPartnerFeeParams = {}): UseQueryResult<FeeResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const amount = params?.amount;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['swapsApi', 'partnerFee', amount],
    queryFn: async (): Promise<FeeResponseV2 | undefined> => {
      if (!amount) return undefined;
      return unwrapResult(await sodax.api.swaps.getPartnerFee({ amount }, apiConfig));
    },
    enabled: !!amount && amount.length > 0,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
