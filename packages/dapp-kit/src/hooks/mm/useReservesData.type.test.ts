/**
 * Compile-time contract: `useReservesData` reads the aggregated reserves and base-currency info, typed exactly, so `data` can never widen to `any`.
 */
import type { AggregatedReserveData, BaseCurrencyInfo } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useReservesData } from './useReservesData.js';

type Data = readonly [readonly AggregatedReserveData[], BaseCurrencyInfo];

describe('useReservesData', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useReservesData>[0]>().toEqualTypeOf<
      { params?: Record<string, never>; queryOptions?: ReadQueryOptions<Data, Error> } | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof useReservesData>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useReservesData>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
