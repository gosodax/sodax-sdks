import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { CreateBridgeIntentParams, GetWalletProviderType, SpokeChainKey } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

export type UseBridgeAllowanceParams<K extends SpokeChainKey> = ReadHookParams<
  boolean,
  {
    payload: CreateBridgeIntentParams<K> | undefined;
    walletProvider: GetWalletProviderType<K> | undefined;
  }
>;

export function useBridgeAllowance<K extends SpokeChainKey>({
  params,
  queryOptions,
}: UseBridgeAllowanceParams<K> = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  const payload = params?.payload;
  const walletProvider = params?.walletProvider;

  return useQuery<boolean, Error>({
    // Key on the scoping tuple only: raw payload objects hold bigints and churn every render.
    queryKey: [
      'bridge',
      'allowance',
      payload?.srcChainKey,
      payload?.srcAddress,
      payload?.srcToken,
      payload?.amount?.toString(),
    ],
    queryFn: async () => {
      if (!payload || !walletProvider) {
        return false;
      }
      const result = await sodax.bridge.isAllowanceValid({
        params: payload,
        raw: false,
        walletProvider,
      });
      return result.ok ? result.value : false;
    },
    enabled: !!payload && !!walletProvider,
    refetchInterval: 2000,
    gcTime: 0,
    ...queryOptions,
  });
}
