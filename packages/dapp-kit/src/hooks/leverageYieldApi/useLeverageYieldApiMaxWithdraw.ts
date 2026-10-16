import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { MaxWithdrawResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiMaxWithdrawParams = ReadHookParams<
  MaxWithdrawResponseV2 | undefined,
  {
    vault: string | undefined;
    owner: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to get the maximum assets an owner can withdraw (ERC-4626 maxWithdraw) via the leverage-yield API —
 * `sodax.api.leverageYield.getMaxWithdraw`.
 *
 * @example
 * const { data } = useLeverageYieldApiMaxWithdraw({ params: { vault: '0x...', owner: '1000000000000000000' } });
 */
export const useLeverageYieldApiMaxWithdraw = ({
  params,
  queryOptions,
}: UseLeverageYieldApiMaxWithdrawParams = {}): UseQueryResult<MaxWithdrawResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const vault = params?.vault;
  const owner = params?.owner;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'maxWithdraw', vault, owner],
    queryFn: async (): Promise<MaxWithdrawResponseV2 | undefined> => {
      if (!vault || owner === undefined) return undefined;
      return unwrapResult(await sodax.api.leverageYield.getMaxWithdraw({ vault, owner }, apiConfig));
    },
    enabled: !!vault && vault.length > 0 && owner !== undefined,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
