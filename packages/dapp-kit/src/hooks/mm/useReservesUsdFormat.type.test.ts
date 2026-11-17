/**
 * Compile-time contract: `useReservesUsdFormat` reads the USD-formatted reserves, typed exactly, so `data` can never widen to `any`.
 */
import type { FormatReserveUSDResponse, ReserveDataHumanized } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useReservesUsdFormat } from './useReservesUsdFormat.js';

type Data = Array<ReserveDataHumanized & FormatReserveUSDResponse>;

describe('useReservesUsdFormat', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useReservesUsdFormat>[0]>().toEqualTypeOf<
      { params?: Record<string, never>; queryOptions?: ReadQueryOptions<Data, Error> } | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof useReservesUsdFormat>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useReservesUsdFormat>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
