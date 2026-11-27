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

/** `query.includeTxData = true` also builds the unsigned tx and requires `srcAddress`/`dstAddress` in the body. */
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
