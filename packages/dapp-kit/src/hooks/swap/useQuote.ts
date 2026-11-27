import type { PartnerFee, Sodax, SolverIntentQuoteRequest } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReadHookParams } from '../shared/types.js';

/** Derived from the SDK method so the error union cannot drift; `undefined` means disabled (no `payload`). */
type SwapQuote = Awaited<ReturnType<Sodax['swaps']['getQuote']>> | undefined;

export type UseQuoteParams = ReadHookParams<SwapQuote, { payload: SolverIntentQuoteRequest | undefined }>;

type SwapQuoteReader = { swaps: Pick<Sodax['swaps'], 'getQuote' | 'partnerFee'> };

/** React Query hashes keys with `JSON.stringify`, which throws on a bigint fee amount. */
function feeKeyPart(fee: PartnerFee | undefined) {
  if (!fee) return undefined;
  return 'amount' in fee ? { ...fee, amount: fee.amount.toString() } : fee;
}

/**
 * Keys on the partner fee too: `getQuote` deducts it from `amount`, so omitting it can serve another fee's (unfillable) quote.
 * Fields are allow-listed, not spread, so a future bigint field cannot crash render; `String()` tolerates a missing `amount`.
 */
function quoteKeyPart(payload: SolverIntentQuoteRequest | undefined, configuredFee: PartnerFee | undefined) {
  if (!payload) return undefined;
  return {
    token_src: payload.token_src,
    token_src_blockchain_id: payload.token_src_blockchain_id,
    token_dst: payload.token_dst,
    token_dst_blockchain_id: payload.token_dst_blockchain_id,
    amount: String(payload.amount),
    quote_type: payload.quote_type,
    partnerFee: feeKeyPart(configuredFee),
  };
}

export function getSwapQuoteQueryOptions({
  sodax,
  payload,
}: {
  sodax: SwapQuoteReader;
  payload: SolverIntentQuoteRequest | undefined;
}) {
  return {
    queryKey: ['swap', 'quote', quoteKeyPart(payload, sodax.swaps.partnerFee)],
    queryFn: async (): Promise<SwapQuote> => {
      if (!payload) {
        return undefined;
      }
      return sodax.swaps.getQuote(payload);
    },
    enabled: !!payload,
    refetchInterval: 3000,
  };
}

/**
 * Polls every 3s; `data` is the SDK `Result`, so branch on `data?.ok`, not `isError`.
 * Deducts the swap fee: use `useLeverageYieldQuote` for leverage-yield vault intents.
 */
export const useQuote = ({ params, queryOptions }: UseQuoteParams = {}): UseQueryResult<SwapQuote> => {
  const { sodax } = useSodaxContext();

  return useQuery({
    ...getSwapQuoteQueryOptions({ sodax, payload: params?.payload }),
    ...queryOptions,
  });
};
