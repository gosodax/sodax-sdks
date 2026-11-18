/** Pins useBackendOracleMarkets's params and query result, with the response body spelled out so `data` cannot widen. */
import type { OracleMarketInterval, OracleMarketsResponse } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useBackendOracleMarkets } from './useBackendOracleMarkets.js';

describe('useBackendOracleMarkets', () => {
  it('takes no domain params', () => {
    expectTypeOf<Parameters<typeof useBackendOracleMarkets>>().toEqualTypeOf<
      [{ params?: Record<string, never>; queryOptions?: ReadQueryOptions<OracleMarketsResponse> }?]
    >();
  });

  it('resolves to the oracle discovery payload', () => {
    expectTypeOf<ReturnType<typeof useBackendOracleMarkets>>().toEqualTypeOf<
      UseQueryResult<OracleMarketsResponse, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBackendOracleMarkets>['data']>>().toEqualTypeOf<{
      quote: string;
      intervals: OracleMarketInterval[];
      symbols: string[];
    }>();
  });
});
