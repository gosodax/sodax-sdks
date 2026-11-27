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

/** `query.includeTxData` also builds the unsigned create-intent tx; `srcAddress`/`dstAddress` are then required. */
export const useSwapsApiQuote = ({
  params,
  queryOptions,
}: UseSwapsApiQuoteParams = {}): UseQueryResult<QuoteResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const body = params?.body;
  const query = params?.query;
  const apiConfig = params?.apiConfig;

  return useQuery({
    // Key on the whole (bigint-free) body so every input, e.g. partnerFee, is a cache dimension.
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
