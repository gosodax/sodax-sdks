import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AllowanceCheckResponseV2, CreateDepositIntentParamsV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiAllowanceParams = ReadHookParams<
  AllowanceCheckResponseV2 | undefined,
  {
    body: CreateDepositIntentParamsV2 | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/** Deposit-only: a withdraw needs no spoke allowance (it spends lsoda* from the hub wallet). */
export const useLeverageYieldApiAllowance = ({
  params,
  queryOptions,
}: UseLeverageYieldApiAllowanceParams = {}): UseQueryResult<AllowanceCheckResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const body = params?.body;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: [
      'leverageYieldApi',
      'allowance',
      body?.vault,
      body?.srcChainKey,
      body?.inputToken,
      body?.inputAmount,
      body?.srcAddress,
    ],
    queryFn: async (): Promise<AllowanceCheckResponseV2 | undefined> => {
      if (!body) return undefined;
      return unwrapResult(await sodax.api.leverageYield.checkAllowance(body, apiConfig));
    },
    enabled: !!body,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
