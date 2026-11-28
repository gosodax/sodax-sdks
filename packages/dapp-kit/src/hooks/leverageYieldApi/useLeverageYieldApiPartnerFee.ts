import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { FeeResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiPartnerFeeParams = ReadHookParams<
  FeeResponseV2 | undefined,
  {
    amount: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/** Returns `{ fee }` as a decimal string. */
export const useLeverageYieldApiPartnerFee = ({
  params,
  queryOptions,
}: UseLeverageYieldApiPartnerFeeParams = {}): UseQueryResult<FeeResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const amount = params?.amount;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'partnerFee', amount],
    queryFn: async (): Promise<FeeResponseV2 | undefined> => {
      if (!amount) return undefined;
      return unwrapResult(await sodax.api.leverageYield.getPartnerFee({ amount }, apiConfig));
    },
    enabled: !!amount && amount.length > 0,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
