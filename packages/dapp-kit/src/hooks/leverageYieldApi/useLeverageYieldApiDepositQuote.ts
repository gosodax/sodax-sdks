import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  LeverageYieldDepositQuoteRequestV2,
  QuoteQueryV2,
  QuoteResponseV2,
  RequestOverrideConfig,
} from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeverageYieldApiDepositQuoteParams = ReadHookParams<
  QuoteResponseV2 | undefined,
  {
    body: LeverageYieldDepositQuoteRequestV2 | undefined;
    query?: QuoteQueryV2;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to quote a swap-style leverage-yield deposit (any token → lsoda* shares) via the
 * leverage-yield API — `sodax.api.leverageYield.getDepositQuote`. Pass `query.includeTxData = true`
 * to also build the unsigned create-intent transaction (`srcAddress` then required in the body).
 *
 * @example
 * const { data: quote } = useLeverageYieldApiDepositQuote({
 *   params: {
 *     body: {
 *       vault: '0x...', tokenSrc: '0x...', tokenSrcChainKey: '0xa4b1.arbitrum',
 *       amount: '1000000', quoteType: 'exact_input',
 *     },
 *   },
 * });
 */
export const useLeverageYieldApiDepositQuote = ({
  params,
  queryOptions,
}: UseLeverageYieldApiDepositQuoteParams = {}): UseQueryResult<QuoteResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const body = params?.body;
  const query = params?.query;
  const apiConfig = params?.apiConfig;

  return useQuery({
    // Hash the whole request body so every quote input (incl. partnerFee) is a cache dimension.
    queryKey: ['leverageYieldApi', 'depositQuote', body, query?.includeTxData ?? false],
    queryFn: async (): Promise<QuoteResponseV2 | undefined> => {
      if (!body) return undefined;
      return unwrapResult(await sodax.api.leverageYield.getDepositQuote(body, query, apiConfig));
    },
    enabled: !!body,
    retry: retryUnlessAuthFailure,
    ...queryOptions,
  });
};
