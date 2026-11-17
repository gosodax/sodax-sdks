/**
 * Compile-time contract: `useReservesList` reads the reserve asset addresses, typed exactly, so `data` can never widen to `any`.
 */
import type { Address } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useReservesList } from './useReservesList.js';

type Data = readonly Address[];

describe('useReservesList', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useReservesList>[0]>().toEqualTypeOf<
      { params?: Record<string, never>; queryOptions?: ReadQueryOptions<Data, Error> } | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof useReservesList>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useReservesList>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
