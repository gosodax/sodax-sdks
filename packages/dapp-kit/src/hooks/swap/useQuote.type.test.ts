/**
 * Compile-time contract for `useQuote` and its `getSwapQuoteQueryOptions`: a read hook whose result does not depend on its inputs, so it pins
 * the accepted params and the exact query data (the solver quote `Result`, `undefined` while disabled).
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type {
  Address,
  PartnerFeePercentage,
  Result,
  Sodax,
  SpokeChainKey,
  SolverErrorResponse,
  SolverIntentQuoteRequest,
  SolverIntentQuoteResponse,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { getSwapQuoteQueryOptions, useQuote } from './useQuote.js';

type Data = Result<SolverIntentQuoteResponse, SolverErrorResponse> | undefined;

describe('useQuote', () => {
  it('accepts optional params and query options typed to its data', () => {
    expectTypeOf<Parameters<typeof useQuote>[0]>().toEqualTypeOf<
      ReadHookParams<Data, { payload: SolverIntentQuoteRequest | undefined }> | undefined
    >();
  });

  it('returns a query whose data is spelled out', () => {
    expectTypeOf<ReturnType<typeof useQuote>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useQuote>['data']>().toEqualTypeOf<Data | undefined>();
  });

  it('getSwapQuoteQueryOptions: the options it builds, with bigints stringified in the key', () => {
    type KeyPart = {
      token_src: string;
      token_src_blockchain_id: SpokeChainKey;
      token_dst: string;
      token_dst_blockchain_id: SpokeChainKey;
      amount: string;
      quote_type: 'exact_input';
      partnerFee: PartnerFeePercentage | { amount: string; address: Address } | undefined;
    };
    expectTypeOf<Parameters<typeof getSwapQuoteQueryOptions>[0]>().toEqualTypeOf<{
      sodax: { swaps: Pick<Sodax['swaps'], 'getQuote' | 'partnerFee'> };
      payload: SolverIntentQuoteRequest | undefined;
    }>();
    expectTypeOf<ReturnType<typeof getSwapQuoteQueryOptions>>().toEqualTypeOf<{
      queryKey: (string | KeyPart | undefined)[];
      queryFn: () => Promise<Data>;
      enabled: boolean;
      refetchInterval: number;
    }>();
  });
});
