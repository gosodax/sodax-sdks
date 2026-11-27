import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { SpokeChainKey, IXServiceBase, XToken } from '@sodax/sdk';
import type { ReadHookParams } from './types.js';

export interface XBalancesInputs {
  xService: IXServiceBase | undefined;
  xChainId: SpokeChainKey | undefined;
  xTokens: readonly XToken[];
  address: string | undefined;
}

export type UseXBalancesParams = ReadHookParams<Record<string, bigint>, XBalancesInputs>;

const REFETCH_INTERVAL_MS = 5_000;

export function getXBalancesQueryOptions({ xService, xChainId, xTokens, address }: XBalancesInputs) {
  return {
    // Symbol alone can collide (scam tokens copy tickers), so pair it with the address.
    queryKey: ['shared', 'xBalances', xChainId, xTokens.map(x => [x.symbol, x.address] as const), address] as const,
    queryFn: async (): Promise<Record<string, bigint>> => {
      if (!xService) return {};
      return xService.getBalances(address, xTokens);
    },
    enabled: !!xService && !!address && xTokens.length > 0,
    refetchInterval: REFETCH_INTERVAL_MS,
  };
}

/** Balances keyed by token address, in smallest units. */
export function useXBalances({
  params,
  queryOptions,
}: UseXBalancesParams = {}): UseQueryResult<Record<string, bigint>> {
  return useQuery({
    ...getXBalancesQueryOptions({
      xService: params?.xService,
      xChainId: params?.xChainId,
      xTokens: params?.xTokens ?? [],
      address: params?.address,
    }),
    ...queryOptions,
  });
}
