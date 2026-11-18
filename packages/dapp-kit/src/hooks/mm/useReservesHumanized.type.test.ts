/**
 * Compile-time contract: `useReservesHumanized` reads the humanized reserves snapshot, typed exactly, so `data` can never widen to `any`.
 */
import type { ReservesDataHumanized } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useReservesHumanized } from './useReservesHumanized.js';

type Data = ReservesDataHumanized;

describe('useReservesHumanized', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useReservesHumanized>[0]>().toEqualTypeOf<
      { params?: Record<string, never>; queryOptions?: ReadQueryOptions<Data, Error> } | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof useReservesHumanized>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useReservesHumanized>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
