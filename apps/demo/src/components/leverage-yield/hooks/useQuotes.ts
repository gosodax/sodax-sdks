import { useMemo } from 'react';
import {
  ChainKeys,
  type LeverageYieldVault,
  type SpokeChainKey,
  type XToken,
  useLeverageYieldApiDepositQuote,
  useLeverageYieldApiWithdrawQuote,
  useLeverageYieldQuote,
} from '@sodax/dapp-kit';
import { useDebouncedValue } from '@/components/swaps-api/lib/useDebouncedValue';
import { retryUnlessClientError } from '../lib/errors';
import { DEPOSIT_PARTNER_FEE } from '../lib/fees';
import { type QuoteState, quoteState } from '../lib/quote';
import { useTransport } from '../transport';

/** Polling interval for live quotes. */
const QUOTE_REFETCH_MS = 10_000;

type DepositQuoteArgs = {
  vault: LeverageYieldVault | undefined;
  srcChainKey: SpokeChainKey;
  token: XToken | undefined;
  inputAmount: bigint | undefined;
};

type WithdrawQuoteArgs = {
  vault: LeverageYieldVault;
  /** The chain the shares are held under (the user signs there). Only the API quote takes it. */
  srcChainKey: SpokeChainKey;
  dstChainKey: SpokeChainKey;
  outputToken: XToken | undefined;
  shares: bigint | undefined;
};

/**
 * Live deposit quote: `inputAmount` of `token` on `srcChainKey` → lsoda* shares of `vault`, via the page's transport.
 * The SDK quote is `useLeverageYieldQuote` (NOT `useQuote`) with the gross amount and the same `partnerFee` the
 * deposit intent charges, so the SDK deducts it once. Both hooks run; the inactive one gets no amount and stays idle.
 */
export function useDepositQuote(args: DepositQuoteArgs): QuoteState {
  const { transport, apiConfig } = useTransport();
  const sdk = useSdkDepositQuote(transport === 'sdk' ? args : { ...args, inputAmount: undefined });
  const api = useApiDepositQuote(transport === 'api' ? args : { ...args, inputAmount: undefined }, apiConfig);
  return transport === 'api' ? api : sdk;
}

export function useWithdrawQuote(args: WithdrawQuoteArgs): QuoteState {
  const { transport, apiConfig } = useTransport();
  const sdk = useSdkWithdrawQuote(transport === 'sdk' ? args : { ...args, shares: undefined });
  const api = useApiWithdrawQuote(transport === 'api' ? args : { ...args, shares: undefined }, apiConfig);
  return transport === 'api' ? api : sdk;
}

function useSdkDepositQuote({ vault, srcChainKey, token, inputAmount }: DepositQuoteArgs): QuoteState {
  const debounced = useDebouncedValue(inputAmount);
  const payload = useMemo(
    () =>
      vault && token && debounced && debounced > 0n
        ? {
            token_src: token.address,
            token_src_blockchain_id: srcChainKey,
            token_dst: vault.vault, // the vault address is the lsoda* share token, on the hub (Sonic)
            token_dst_blockchain_id: ChainKeys.SONIC_MAINNET,
            amount: debounced,
            quote_type: 'exact_input' as const,
            partnerFee: DEPOSIT_PARTNER_FEE,
          }
        : undefined,
    [vault, token, srcChainKey, debounced],
  );
  const query = useLeverageYieldQuote({ params: { payload }, queryOptions: { refetchInterval: QUOTE_REFETCH_MS } });
  const result = query.data;
  return quoteState({
    amountOut: result?.ok ? result.value.quoted_amount : undefined,
    error: result && !result.ok ? result.error : undefined,
    typing: inputAmount !== debounced,
    waiting: !!payload && query.isFetching && !result,
    refetch: query.refetch,
  });
}

/** The SDK quote's source is the vault on the hub: token_src = vault on Sonic, not the chain the user signs on. */
function useSdkWithdrawQuote({ vault, dstChainKey, outputToken, shares }: WithdrawQuoteArgs): QuoteState {
  const debounced = useDebouncedValue(shares);
  const payload = useMemo(
    () =>
      outputToken && debounced && debounced > 0n
        ? {
            token_src: vault.vault,
            token_src_blockchain_id: ChainKeys.SONIC_MAINNET,
            token_dst: outputToken.address,
            token_dst_blockchain_id: dstChainKey,
            amount: debounced,
            quote_type: 'exact_input' as const,
          }
        : undefined,
    [vault, outputToken, dstChainKey, debounced],
  );
  const query = useLeverageYieldQuote({ params: { payload }, queryOptions: { refetchInterval: QUOTE_REFETCH_MS } });
  const result = query.data;
  return quoteState({
    amountOut: result?.ok ? result.value.quoted_amount : undefined,
    error: result && !result.ok ? result.error : undefined,
    typing: shares !== debounced,
    waiting: !!payload && query.isFetching && !result,
    refetch: query.refetch,
  });
}

/** POST /leverage-yield/quote/deposit. A 4xx such as "Input amount too low" won't change on retry: show it now. */
function useApiDepositQuote(
  { vault, srcChainKey, token, inputAmount }: DepositQuoteArgs,
  apiConfig: ReturnType<typeof useTransport>['apiConfig'],
): QuoteState {
  const debounced = useDebouncedValue(inputAmount);
  const body = useMemo(
    () =>
      vault && token && debounced && debounced > 0n
        ? {
            vault: vault.vault,
            tokenSrc: token.address,
            tokenSrcChainKey: srcChainKey,
            amount: debounced.toString(),
            quoteType: 'exact_input' as const,
          }
        : undefined,
    [vault, token, srcChainKey, debounced],
  );
  const query = useLeverageYieldApiDepositQuote({
    params: { body, apiConfig },
    queryOptions: { refetchInterval: QUOTE_REFETCH_MS, retry: retryUnlessClientError },
  });
  return quoteState({
    amountOut: toBigInt(query.data?.quotedAmount),
    error: query.error,
    typing: inputAmount !== debounced,
    waiting: !!body && query.isFetching && !query.data,
    refetch: query.refetch,
  });
}

/** POST /leverage-yield/quote/withdraw. The API takes the signing chain as `srcChainKey`. */
function useApiWithdrawQuote(
  { vault, srcChainKey, dstChainKey, outputToken, shares }: WithdrawQuoteArgs,
  apiConfig: ReturnType<typeof useTransport>['apiConfig'],
): QuoteState {
  const debounced = useDebouncedValue(shares);
  const body = useMemo(
    () =>
      outputToken && debounced && debounced > 0n
        ? {
            vault: vault.vault,
            srcChainKey,
            tokenDst: outputToken.address,
            tokenDstChainKey: dstChainKey,
            amount: debounced.toString(),
            quoteType: 'exact_input' as const,
          }
        : undefined,
    [vault, srcChainKey, dstChainKey, outputToken, debounced],
  );
  const query = useLeverageYieldApiWithdrawQuote({
    params: { body, apiConfig },
    queryOptions: { refetchInterval: QUOTE_REFETCH_MS, retry: retryUnlessClientError },
  });
  return quoteState({
    amountOut: toBigInt(query.data?.quotedAmount),
    error: query.error,
    typing: shares !== debounced,
    waiting: !!body && query.isFetching && !query.data,
    refetch: query.refetch,
  });
}

function toBigInt(value: string | undefined): bigint | undefined {
  return value ? BigInt(value) : undefined;
}
