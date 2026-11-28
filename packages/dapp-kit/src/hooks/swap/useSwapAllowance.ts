import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { CreateIntentParams, CreateLimitOrderParams } from '@sodax/sdk';
import type { GetWalletProviderType, SpokeChainKey } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseSwapAllowanceParams<K extends SpokeChainKey> = ReadHookParams<
  boolean,
  {
    payload: CreateIntentParams | CreateLimitOrderParams | undefined;
    srcChainKey: K | undefined;
    walletProvider: GetWalletProviderType<K> | undefined;
  }
>;

export function useSwapAllowance<K extends SpokeChainKey>({
  params,
  queryOptions,
}: UseSwapAllowanceParams<K> = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  const payload = params?.payload;
  const srcChainKey = params?.srcChainKey;
  const walletProvider = params?.walletProvider;

  return useQuery<boolean, Error>({
    // Key on the scoping tuple only: raw payload objects hold bigints and churn every render.
    queryKey: [
      'swap',
      'allowance',
      payload?.srcChainKey,
      payload?.srcAddress,
      payload?.inputToken,
      payload?.inputAmount?.toString(),
    ],
    queryFn: async () => {
      if (!srcChainKey || !walletProvider || !payload) {
        return false;
      }
      const allowance = await sodax.swaps.isAllowanceValid({
        params: payload as CreateIntentParams,
        raw: false,
        walletProvider,
      });
      return allowance.ok ? allowance.value : false;
    },
    enabled: !!srcChainKey && !!walletProvider && !!payload,
    refetchInterval: 2000,
    ...queryOptions,
  });
}
