import { ChainKeys, type Sodax, type SpokeChainKey, type XrpDestinationReadiness } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReadHookParams } from './types.js';
import { useSodaxContext } from './useSodaxContext.js';

export type UseXrpDestinationCheckParams = ReadHookParams<
  XrpDestinationReadiness,
  {
    chainId: SpokeChainKey | undefined;
    token: string | undefined;
    address: string | undefined;
    /** The least that arrives, in the token's decimals. */
    amount: bigint | undefined;
    /** The most that can arrive, which the trustline needs room for. Defaults to `amount`. */
    maxAmount?: bigint;
  }
>;

type XrpDestinationReader = { spoke: { xrp: Pick<Sodax['spoke']['xrp'], 'checkDestination'> } };

export function getXrpDestinationCheckQueryOptions({
  sodax,
  chainId,
  token,
  address,
  amount,
  maxAmount,
}: {
  sodax: XrpDestinationReader;
  chainId: SpokeChainKey | undefined;
  token: string | undefined;
  address: string | undefined;
  amount: bigint | undefined;
  maxAmount?: bigint;
}) {
  return {
    queryKey: [
      'shared',
      'xrpDestinationCheck',
      chainId,
      token,
      address,
      amount?.toString(),
      maxAmount?.toString(),
    ] as const,
    queryFn: async (): Promise<XrpDestinationReadiness> => {
      if (!address || !token || amount === undefined) throw new Error('address, token and amount are required');
      return sodax.spoke.xrp.checkDestination({ address, token, amount, maxAmount });
    },
    enabled: chainId === ChainKeys.XRP_MAINNET && !!address && !!token && amount !== undefined,
  };
}

/** Whether an XRPL account can receive `amount` of `token` (up to `maxAmount`), and if not, why. */
export function useXrpDestinationCheck({
  params,
  queryOptions,
}: UseXrpDestinationCheckParams = {}): UseQueryResult<XrpDestinationReadiness, Error> {
  const { sodax } = useSodaxContext();
  return useQuery<XrpDestinationReadiness, Error>({
    ...getXrpDestinationCheckQueryOptions({
      sodax,
      chainId: params?.chainId,
      token: params?.token,
      address: params?.address,
      amount: params?.amount,
      maxAmount: params?.maxAmount,
    }),
    ...queryOptions,
  });
}
