import type { Sodax } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReadHookParams } from './types.js';
import { useSodaxContext } from './useSodaxContext.js';

export type UseXrpTrustlineReserveCheckParams = ReadHookParams<
  boolean,
  {
    token: string | undefined;
    address: string | undefined;
  }
>;

type XrpReserveReader = { spoke: { xrp: Pick<Sodax['spoke']['xrp'], 'canAffordTrustline'> } };

export function getXrpTrustlineReserveCheckQueryOptions({
  sodax,
  token,
  address,
}: {
  sodax: XrpReserveReader;
  token: string | undefined;
  address: string | undefined;
}) {
  return {
    queryKey: ['shared', 'xrpTrustlineReserveCheck', token, address] as const,
    queryFn: async (): Promise<boolean> => {
      if (!address || !token) throw new Error('address and token are required');
      return sodax.spoke.xrp.canAffordTrustline({ address, token });
    },
    enabled: !!address && !!token,
  };
}

/** Whether an XRPL account holds the spendable XRP to set the trustline for an issued `token`. */
export function useXrpTrustlineReserveCheck({
  params,
  queryOptions,
}: UseXrpTrustlineReserveCheckParams = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  return useQuery<boolean, Error>({
    ...getXrpTrustlineReserveCheckQueryOptions({ sodax, token: params?.token, address: params?.address }),
    ...queryOptions,
  });
}
