import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { FeeResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiSolverFeeParams = ReadHookParams<
  FeeResponseV2 | undefined,
  {
    amount: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to compute the protocol (solver) fee for a given input amount via the leverage-yield API — `sodax.api.leverageYield.getSolverFee`.
 * Returns `{ fee }` (decimal string).
 *
 * @example
 * const { data } = useLeverageYieldApiSolverFee({ params: { amount: '1000000' } });
 */
export const useLeverageYieldApiSolverFee = ({
  params,
  queryOptions,
}: UseLeverageYieldApiSolverFeeParams = {}): UseQueryResult<FeeResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const amount = params?.amount;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'solverFee', amount],
    queryFn: async (): Promise<FeeResponseV2 | undefined> => {
      if (!amount) return undefined;
      return unwrapResult(await sodax.api.leverageYield.getSolverFee({ amount }, apiConfig));
    },
    enabled: !!amount && amount.length > 0,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
