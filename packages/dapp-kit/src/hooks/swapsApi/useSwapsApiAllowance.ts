import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AllowanceCheckResponseV2, CreateIntentParamsV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseSwapsApiAllowanceParams = ReadHookParams<
  AllowanceCheckResponseV2 | undefined,
  {
    body: CreateIntentParamsV2 | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to check whether the source-token allowance is already sufficient for an intent via
 * the swaps API — `sodax.api.swaps.checkAllowance`. Returns `{ valid }`.
 *
 * @example
 * const { data: allowance } = useSwapsApiAllowance({ params: { body: createIntentParams } });
 */
export const useSwapsApiAllowance = ({
  params,
  queryOptions,
}: UseSwapsApiAllowanceParams = {}): UseQueryResult<AllowanceCheckResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const body = params?.body;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['swapsApi', 'allowance', body?.srcChainKey, body?.inputToken, body?.inputAmount, body?.srcAddress],
    queryFn: async (): Promise<AllowanceCheckResponseV2 | undefined> => {
      if (!body) return undefined;
      return unwrapResult(await sodax.api.swaps.checkAllowance(body, apiConfig));
    },
    enabled: !!body,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
