import { ChainKeys, type Sodax, type SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from './useSodaxContext.js';
import type { ReadHookParams } from './types.js';

export type UseStellarTrustlineCheckParams = ReadHookParams<
  boolean,
  {
    token: string | undefined;
    amount: bigint | undefined;
    chainId: SpokeChainKey | undefined;
    walletAddress: string | undefined;
  }
>;

// Narrow slice so tests can pass a minimal stub without casting `Sodax`.
type StellarTrustlineReader = { spoke: { stellar: Pick<Sodax['spoke']['stellar'], 'hasSufficientTrustline'> } };

export function getStellarTrustlineCheckQueryOptions({
  sodax,
  token,
  amount,
  chainId,
  walletAddress,
}: {
  sodax: StellarTrustlineReader;
  token: string | undefined;
  amount: bigint | undefined;
  chainId: SpokeChainKey | undefined;
  walletAddress: string | undefined;
}) {
  return {
    queryKey: ['shared', 'stellarTrustlineCheck', chainId, token, walletAddress, amount?.toString()] as const,
    queryFn: async (): Promise<boolean> => {
      if (chainId !== ChainKeys.STELLAR_MAINNET) return true;
      if (!walletAddress || !token || !amount) return false;
      return sodax.spoke.stellar.hasSufficientTrustline(token, amount, walletAddress);
    },
    enabled: !!walletAddress && !!token && !!amount,
  };
}

export function useStellarTrustlineCheck({
  params,
  queryOptions,
}: UseStellarTrustlineCheckParams = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  return useQuery<boolean, Error>({
    ...getStellarTrustlineCheckQueryOptions({
      sodax,
      token: params?.token,
      amount: params?.amount,
      chainId: params?.chainId,
      walletAddress: params?.walletAddress,
    }),
    ...queryOptions,
  });
}
