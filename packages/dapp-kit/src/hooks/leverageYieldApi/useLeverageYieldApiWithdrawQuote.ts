import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  LeverageYieldWithdrawQuoteRequestV2,
  QuoteQueryV2,
  QuoteResponseV2,
  RequestOverrideConfig,
} from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiWithdrawQuoteParams = ReadHookParams<
  QuoteResponseV2 | undefined,
  {
    body: LeverageYieldWithdrawQuoteRequestV2 | undefined;
    query?: QuoteQueryV2;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to quote a swap-style leverage-yield withdraw (lsoda* shares → any token) via the
 * leverage-yield API — `sodax.api.leverageYield.getWithdrawQuote`. Pass `query.includeTxData = true`
 * to also build the unsigned transaction (`srcAddress`/`dstAddress` then required in the body).
 *
 * @example
 * const { data: quote } = useLeverageYieldApiWithdrawQuote({
 *   params: {
 *     body: {
 *       vault: '0x...', srcChainKey: 'sonic', tokenDst: '0x...', tokenDstChainKey: '0xa4b1.arbitrum',
 *       amount: '1000000000000000000', quoteType: 'exact_input',
 *     },
 *   },
 * });
 */
export const useLeverageYieldApiWithdrawQuote = ({
  params,
  queryOptions,
}: UseLeverageYieldApiWithdrawQuoteParams = {}): UseQueryResult<QuoteResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const body = params?.body;
  const query = params?.query;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: ['leverageYieldApi', 'withdrawQuote', body, query?.includeTxData ?? false],
    queryFn: async (): Promise<QuoteResponseV2 | undefined> => {
      if (!body) return undefined;
      return unwrapResult(await sodax.api.leverageYield.getWithdrawQuote(body, query, apiConfig));
    },
    enabled: !!body,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
