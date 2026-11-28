import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { ChainKeys, type Sodax, type SpokeChainKey, type XToken } from '@sodax/sdk';
import { useSodaxContext } from './useSodaxContext.js';
import { unwrapResult } from './unwrapResult.js';
import type { ReadHookParams } from './types.js';

/** The SDK ignores `token.chainKey`: a token not on `chainKey` reads as `0n` rather than erroring. */
export interface BalancesInputs {
  chainKey: SpokeChainKey | undefined;
  tokens: readonly XToken[];
  address: string | undefined;
  /** TON only: wallet account to read. Defaults to the public key’s wallet-v4R2 address. */
  accountAddress?: string;
}

export type UseBalancesParams = ReadHookParams<Record<string, bigint>, BalancesInputs>;

const REFETCH_INTERVAL_MS = 5_000;

export function getBalancesQueryOptions(sodax: Sodax, { chainKey, tokens, address, accountAddress }: BalancesInputs) {
  const tonAccount = chainKey === ChainKeys.TON_MAINNET && accountAddress ? { accountAddress } : undefined;
  return {
    // Symbol alone can collide (scam tokens copy tickers), so pair it with the address.
    queryKey: [
      'shared',
      'balances',
      chainKey,
      tokens.map(t => [t.symbol, t.address] as const),
      address,
      ...(tonAccount ? [tonAccount.accountAddress] : []),
    ] as const,
    queryFn: async (): Promise<Record<string, bigint>> => {
      if (!chainKey || !address) return {};
      return unwrapResult(
        await sodax.spoke.getWalletBalances({ srcChainKey: chainKey, srcAddress: address, tokens, ...tonAccount }),
      );
    },
    enabled: !!chainKey && !!address && tokens.length > 0,
    refetchInterval: REFETCH_INTERVAL_MS,
    // No `keepPreviousData`: EVM chains share the native token address, so a chain switch would
    // show the previous chain's native balance until the fetch lands.
  };
}

/**
 * Balances keyed by token address. An unreadable token reports `0n`; the query errors only when the
 * whole batch fails. Stellar XLM is the spendable amount; Bitcoin Runes read `0n`.
 */
export function useBalances({ params, queryOptions }: UseBalancesParams = {}): UseQueryResult<Record<string, bigint>> {
  const { sodax } = useSodaxContext();

  return useQuery({
    ...getBalancesQueryOptions(sodax, {
      chainKey: params?.chainKey,
      tokens: params?.tokens ?? [],
      address: params?.address,
      accountAddress: params?.accountAddress,
    }),
    ...queryOptions,
  });
}
