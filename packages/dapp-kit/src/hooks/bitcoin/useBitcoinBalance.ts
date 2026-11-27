import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReadHookParams } from '../shared/types.js';

export type UseBitcoinBalanceParams = ReadHookParams<
  bigint,
  {
    address: string | undefined;
    rpcUrl?: string;
  }
>;

const DEFAULT_RPC_URL = 'https://mempool.space/api';

/** Sums all UTXOs (confirmed + unconfirmed); the UTXO set already excludes spent outputs. */
export function useBitcoinBalance({
  params,
  queryOptions,
}: UseBitcoinBalanceParams = {}): UseQueryResult<bigint, Error> {
  const address = params?.address;
  const rpcUrl = params?.rpcUrl ?? DEFAULT_RPC_URL;

  return useQuery<bigint, Error>({
    queryKey: ['bitcoin', 'balance', address],
    queryFn: async () => {
      if (!address) return 0n;

      const response = await fetch(`${rpcUrl}/address/${address}/utxo`);
      if (!response.ok) return 0n;

      const utxos: Array<{ value: number }> = await response.json();
      return BigInt(utxos.reduce((sum, utxo) => sum + utxo.value, 0));
    },
    enabled: !!address,
    ...queryOptions,
  });
}
