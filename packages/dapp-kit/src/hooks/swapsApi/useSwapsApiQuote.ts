import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { QuoteQueryV2, QuoteRequestV2, QuoteResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseSwapsApiQuoteParams = ReadHookParams<
  QuoteResponseV2 | undefined,
  {
    body: QuoteRequestV2 | undefined;
    query?: QuoteQueryV2;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to get a solver quote for a cross-chain swap via the swaps API —
 * `sodax.api.swaps.getQuote`. Pass `query.includeTxData = true` to also build an unsigned
 * create-intent transaction (`txData`); `srcAddress`/`dstAddress` are then required in the body.
 *
 * @example
 * const { data: quote } = useSwapsApiQuote({
 *   params: {
 *     body: {
 *       tokenSrc: '0x...', tokenSrcChainKey: '0xa4b1.arbitrum',
 *       tokenDst: '0x...', tokenDstChainKey: 'sonic',
 *       amount: '1000000', quoteType: 'exact_input',
 *       partnerFee: { address: '0xSonicFeeReceiver', percentage: 10 },
 *     },
 *     // Optional per-request override of the configured backend API key (`x-api-key`);
 *     // usually set once instead via new Sodax({ apiKey }).
 *     apiConfig: { apiKey: 'partner-api-key' },
 *   },
 * });
 */
export const useSwapsApiQuote = ({
  params,
  queryOptions,
}: UseSwapsApiQuoteParams = {}): UseQueryResult<QuoteResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const body = params?.body;
  const query = params?.query;
  const apiConfig = params?.apiConfig;

  return useQuery({
    // Hash the whole request body so every quote input — including partnerFee and the other
    // SwapExtrasV2 fields — is a cache dimension; a partnerFee change alters the quote and must
    // miss the cache. QuoteRequestV2 is bigint-free (compile-time guaranteed), so React Query's
    // default key hashing handles the object directly.
    queryKey: ['swapsApi', 'quote', body, query?.includeTxData ?? false],
    queryFn: async (): Promise<QuoteResponseV2 | undefined> => {
      if (!body) return undefined;
      return unwrapResult(await sodax.api.swaps.getQuote(body, query, apiConfig));
    },
    enabled: !!body,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
