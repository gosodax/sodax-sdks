/** Pins `useLeverageYieldQuote` and `getLeverageYieldQuoteQueryOptions`: the quote is the un-unwrapped `Result` of `leverageYield.getQuote`. */
import type { UseQueryResult } from '@tanstack/react-query';
import type {
  Address,
  LeverageYieldLookupError,
  LeverageYieldQuoteParams,
  PartnerFeePercentage,
  QuoteType,
  Result,
  Sodax,
  SolverErrorResponse,
  SolverIntentQuoteResponse,
  SpokeChainKey,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { getLeverageYieldQuoteQueryOptions, useLeverageYieldQuote } from './useLeverageYieldQuote.js';

type Quote = Result<SolverIntentQuoteResponse, SolverErrorResponse | LeverageYieldLookupError> | undefined;

// bigints are stringified so the key stays serialisable.
type QuoteKeyPart = {
  token_src: string;
  token_src_blockchain_id: SpokeChainKey;
  token_dst: string;
  token_dst_blockchain_id: SpokeChainKey;
  amount: string;
  quote_type: QuoteType;
  partnerFee: PartnerFeePercentage | { amount: string; address: Address } | undefined;
};

describe('useLeverageYieldQuote', () => {
  it('accepts its read params', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldQuote>[0]>().toEqualTypeOf<
      ReadHookParams<Quote, { payload: LeverageYieldQuoteParams | undefined }> | undefined
    >();
  });

  it('returns the service Result as query data', () => {
    expectTypeOf<ReturnType<typeof useLeverageYieldQuote>>().toEqualTypeOf<UseQueryResult<Quote, Error>>();
    expectTypeOf<Awaited<ReturnType<Sodax['leverageYield']['getQuote']>>>().toEqualTypeOf<Exclude<Quote, undefined>>();
  });
});

describe('getLeverageYieldQuoteQueryOptions', () => {
  it('reads only the fee config and the quote method', () => {
    expectTypeOf<Parameters<typeof getLeverageYieldQuoteQueryOptions>>().toEqualTypeOf<
      [
        {
          sodax: {
            config: Pick<Sodax['config'], 'leverageYieldPartnerFee'>;
            leverageYield: Pick<Sodax['leverageYield'], 'getQuote'>;
          };
          payload: LeverageYieldQuoteParams | undefined;
        },
      ]
    >();
  });

  it('returns query options keyed by a serialisable quote request', () => {
    expectTypeOf<ReturnType<typeof getLeverageYieldQuoteQueryOptions>>().toEqualTypeOf<{
      queryKey: (string | QuoteKeyPart | undefined)[];
      queryFn: () => Promise<Quote>;
      enabled: boolean;
      refetchInterval: number;
    }>();
  });
});
