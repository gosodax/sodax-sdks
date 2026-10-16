import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { Sodax, SpokeChainKey, XToken } from '@sodax/sdk';
import { useSodaxContext } from './useSodaxContext.js';
import { unwrapResult } from './unwrapResult.js';
import type { ReadHookParams } from './types.js';

/**
 * Domain inputs for {@link useBalances}. `chainKey` is optional so the hook can be mounted before a
 * chain is selected; `enabled` gates execution on every required field being present.
 *
 * The SDK reads the chain named by `chainKey` and ignores `token.chainKey`, so a token that does
 * not live on that chain reads as `0n` rather than erroring — keep the two in step.
 */
export interface BalancesInputs {
  chainKey: SpokeChainKey | undefined;
  tokens: readonly XToken[];
  address: string | undefined;
}

export type UseBalancesParams = ReadHookParams<Record<string, bigint>, BalancesInputs>;

const REFETCH_INTERVAL_MS = 5_000;

/**
 * Pure builder for {@link useBalances} query options. Exported for unit tests and for advanced
 * callers that compose their own `useQuery` wrapper. Takes the SDK instance explicitly (the hook
 * supplies it from context).
 */
export function getBalancesQueryOptions(sodax: Sodax, { chainKey, tokens, address }: BalancesInputs) {
  return {
    // Pair symbol + address: readable in devtools, unique on-chain (symbol alone can collide —
    // e.g. scam tokens copying a legitimate ticker).
    queryKey: ['shared', 'balances', chainKey, tokens.map(t => [t.symbol, t.address] as const), address] as const,
    queryFn: async (): Promise<Record<string, bigint>> => {
      if (!chainKey || !address) return {};
      return unwrapResult(await sodax.spoke.getWalletBalances({ srcChainKey: chainKey, srcAddress: address, tokens }));
    },
    enabled: !!chainKey && !!address && tokens.length > 0,
    refetchInterval: REFETCH_INTERVAL_MS,
    // Deliberately NOT `placeholderData: keepPreviousData`: the query key carries the chain, so a
    // chain switch would surface the previous chain's map — and every EVM chain shares the native
    // token address, so its native balance would render as the new chain's until the fetch lands.
  };
}

/**
 * Fetch a user's own wallet balances for multiple tokens on a specific chain, straight from the
 * core SDK (`sodax.spoke.getWalletBalances`) — no wallet SDK / `xService` required. Returns an
 * object mapping each token's address to its balance in smallest units.
 *
 * This is the SDK-backed successor to {@link useXBalances} (which wraps a wallet-layer `xService`).
 * Prefer this when the app already has a `SodaxProvider`.
 *
 * Failure model: a token that could not be read is logged by the SDK and reported as `0n`, so a
 * flaky RPC is indistinguishable from an empty wallet — always the conservative direction, since
 * under-reporting blocks a spend rather than permitting one. The query only errors when the whole
 * batch is unusable: a shared round-trip every token depends on, or a batch in which no token
 * could be read at all.
 *
 * Chain-specific notes: Stellar XLM reports the *spendable* amount (total minus the minimum reserve
 * and selling liabilities); Bitcoin returns `0n` for Rune tokens, whose amounts are not exposed by
 * the UTXO endpoint.
 *
 * @example
 * ```tsx
 * const { data: balances } = useBalances({ params: { chainKey, address, tokens } });
 * const usdcBalance = balances?.[usdc.address] ?? 0n;
 * ```
 */
export function useBalances({ params, queryOptions }: UseBalancesParams = {}): UseQueryResult<Record<string, bigint>> {
  const { sodax } = useSodaxContext();

  return useQuery({
    ...getBalancesQueryOptions(sodax, {
      chainKey: params?.chainKey,
      tokens: params?.tokens ?? [],
      address: params?.address,
    }),
    ...queryOptions,
  });
}
