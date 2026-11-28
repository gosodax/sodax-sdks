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

/** ERC-4626 `maxWithdraw` for `owner`. */
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
