import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ShareBalanceResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiShareBalanceParams = ReadHookParams<
  ShareBalanceResponseV2 | undefined,
  {
    vault: string | undefined;
    owner: string | undefined;
    apiConfig?: RequestOverrideConfig;
  }
>;

export const useLeverageYieldApiShareBalance = ({
  params,
  queryOptions,
}: UseLeverageYieldApiShareBalanceParams = {}): UseQueryResult<ShareBalanceResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const vault = params?.vault;
  const owner = params?.owner;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'shareBalance', vault, owner],
    queryFn: async (): Promise<ShareBalanceResponseV2 | undefined> => {
      if (!vault || owner === undefined) return undefined;
      return unwrapResult(await sodax.api.leverageYield.getShareBalance({ vault, owner }, apiConfig));
    },
    enabled: !!vault && vault.length > 0 && owner !== undefined,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
