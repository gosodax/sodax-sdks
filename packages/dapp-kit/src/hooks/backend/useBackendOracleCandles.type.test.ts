/** Pins useBackendOracleCandles's params and query result, with the response body spelled out so `data` cannot widen. */
import type { OracleCandle, OracleCandleInterval, OracleCandlesResponse } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useBackendOracleCandles } from './useBackendOracleCandles.js';

describe('useBackendOracleCandles', () => {
  it('takes a symbol, interval and range', () => {
    expectTypeOf<Parameters<typeof useBackendOracleCandles>>().toEqualTypeOf<
      [
        {
          params?: { symbol: string; interval: OracleCandleInterval; from: number; to: number };
          queryOptions?: ReadQueryOptions<OracleCandlesResponse>;
        }?,
      ]
    >();
    expectTypeOf<OracleCandleInterval>().toEqualTypeOf<'1m' | '5m' | '1h' | '1d'>();
  });

  it('resolves to the candles response', () => {
    expectTypeOf<ReturnType<typeof useBackendOracleCandles>>().toEqualTypeOf<
      UseQueryResult<OracleCandlesResponse, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBackendOracleCandles>['data']>>().toEqualTypeOf<{
      symbol: string;
      quote: string;
      interval: OracleCandleInterval;
      candles: OracleCandle[];
    }>();
  });
});
