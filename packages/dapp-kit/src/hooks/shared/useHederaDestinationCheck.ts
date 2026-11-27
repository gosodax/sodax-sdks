import { ChainKeys, type HederaDestinationReadiness, type Sodax, type SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReadHookParams } from './types.js';
import { useSodaxContext } from './useSodaxContext.js';

export type UseHederaDestinationCheckParams = ReadHookParams<
  HederaDestinationReadiness,
  {
    chainId: SpokeChainKey | undefined;
    /** The HTS token to receive. */
    token: string | undefined;
    /** The Hedera EVM address that receives the payout. */
    address: string | undefined;
  }
>;

type HederaDestinationReader = { spoke: { hedera: Pick<Sodax['spoke']['hedera'], 'checkDestination'> } };

export function getHederaDestinationCheckQueryOptions({
  sodax,
  chainId,
  token,
  address,
}: {
  sodax: HederaDestinationReader;
  chainId: SpokeChainKey | undefined;
  token: string | undefined;
  address: string | undefined;
}) {
  return {
    queryKey: ['shared', 'hederaDestinationCheck', chainId, token, address] as const,
    queryFn: async (): Promise<HederaDestinationReadiness> => {
      if (!address || !token) throw new Error('address and token are required');
      return sodax.spoke.hedera.checkDestination({ address, token });
    },
    enabled: chainId === ChainKeys.HEDERA_MAINNET && !!address && !!token,
  };
}

/**
 * Whether a Hedera account can receive `token`, and if not, why. It reads the same mirror-node state a swap
 * or withdrawal is refused on before signing: only an existing association counts.
 */
export function useHederaDestinationCheck({
  params,
  queryOptions,
}: UseHederaDestinationCheckParams = {}): UseQueryResult<HederaDestinationReadiness, Error> {
  const { sodax } = useSodaxContext();
  return useQuery<HederaDestinationReadiness, Error>({
    ...getHederaDestinationCheckQueryOptions({
      sodax,
      chainId: params?.chainId,
      token: params?.token,
      address: params?.address,
    }),
    ...queryOptions,
  });
}
