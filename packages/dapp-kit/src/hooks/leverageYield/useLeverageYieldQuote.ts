import type { LeverageYieldQuoteParams, PartnerFee, Sodax } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

// Derived from the SDK method so the error union cannot drift; `undefined` is the disabled state.
type LeverageYieldQuote = Awaited<ReturnType<Sodax['leverageYield']['getQuote']>> | undefined;

export type UseLeverageYieldQuoteParams = ReadHookParams<
  LeverageYieldQuote,
  { payload: LeverageYieldQuoteParams | undefined }
>;

type LeverageYieldQuoteReader = {
  config: Pick<Sodax['config'], 'leverageYieldPartnerFee'>;
  leverageYield: Pick<Sodax['leverageYield'], 'getQuote'>;
};

/** React Query hashes keys with `JSON.stringify`, which throws on a bigint fee amount. */
function feeKeyPart(fee: PartnerFee | undefined) {
  if (!fee) return undefined;
  return 'amount' in fee ? { ...fee, amount: fee.amount.toString() } : fee;
}

/**
 * Keys on the effective fee (configured fallback included) and an explicit field allow-list, since a spread could carry
 * a bigint into the key; `String(amount)` keeps render-time key derivation total for half-filled form state.
 */
function quoteKeyPart(payload: LeverageYieldQuoteParams | undefined, effectiveFee: PartnerFee | undefined) {
  if (!payload) return undefined;
  return {
    token_src: payload.token_src,
    token_src_blockchain_id: payload.token_src_blockchain_id,
    token_dst: payload.token_dst,
    token_dst_blockchain_id: payload.token_dst_blockchain_id,
    amount: String(payload.amount),
    quote_type: payload.quote_type,
    partnerFee: feeKeyPart(effectiveFee),
  };
}

export function getLeverageYieldQuoteQueryOptions({
  sodax,
  payload,
}: {
  sodax: LeverageYieldQuoteReader;
  payload: LeverageYieldQuoteParams | undefined;
}) {
  const effectiveFee = payload?.partnerFee ?? sodax.config.leverageYieldPartnerFee;
  return {
    queryKey: ['leverageYield', 'quote', quoteKeyPart(payload, effectiveFee)],
    queryFn: async (): Promise<LeverageYieldQuote> => {
      if (!payload) return undefined;
      return sodax.leverageYield.getQuote(payload);
    },
    enabled: !!payload,
    refetchInterval: 3000,
  };
}

/**
 * Vault deposit (vault as `token_dst`) or withdraw (as `token_src`) quote, priced on the leverage-yield fee, unlike {@link useQuote}.
 * Pass the same `partnerFee` here as to the builder (or omit on both). Returns the SDK `Result` as data.
 */
export function useLeverageYieldQuote({
  params,
  queryOptions,
}: UseLeverageYieldQuoteParams = {}): UseQueryResult<LeverageYieldQuote, Error> {
  const { sodax } = useSodaxContext();

  return useQuery<LeverageYieldQuote, Error>({
    ...getLeverageYieldQuoteQueryOptions({ sodax, payload: params?.payload }),
    ...queryOptions,
  });
}
