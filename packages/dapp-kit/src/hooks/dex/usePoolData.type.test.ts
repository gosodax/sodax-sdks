/**
 * Compile-time contract: `usePoolData` reads the pool state, typed exactly, so `data` can never widen to `any`.
 */
import type { PoolData, PoolKey } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { usePoolData } from './usePoolData.js';

type Data = PoolData;

describe('usePoolData', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof usePoolData>[0]>().toEqualTypeOf<
      { params?: { poolKey: PoolKey | null }; queryOptions?: ReadQueryOptions<Data, Error> } | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof usePoolData>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof usePoolData>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
