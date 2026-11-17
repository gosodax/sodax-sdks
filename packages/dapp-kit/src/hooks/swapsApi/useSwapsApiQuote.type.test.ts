/** Pins useSwapsApiQuote's params and query result, with the response body spelled out so `data` cannot widen. */
import type {
  CreateIntentResponseV2,
  QuoteQueryV2,
  QuoteRequestV2,
  QuoteResponseV2,
  RequestOverrideConfig,
} from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useSwapsApiQuote } from './useSwapsApiQuote.js';

describe('useSwapsApiQuote', () => {
  it('takes the quote body and an optional query', () => {
    expectTypeOf<Parameters<typeof useSwapsApiQuote>>().toEqualTypeOf<
      [
        {
          params?: { body: QuoteRequestV2 | undefined; query?: QuoteQueryV2; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<QuoteResponseV2 | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the quote, undefined until the body is set', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiQuote>>().toEqualTypeOf<
      UseQueryResult<QuoteResponseV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiQuote>['data']>>().toEqualTypeOf<{
      quotedAmount: string;
      txData?: CreateIntentResponseV2;
    }>();
  });
});
