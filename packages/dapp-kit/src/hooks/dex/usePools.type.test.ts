/**
 * Compile-time contract: `usePools` reads the pool keys, typed exactly, so `data` can never widen to `any`.
 */
import type { PoolKey } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { usePools } from './usePools.js';

type Data = PoolKey[];

describe('usePools', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof usePools>[0]>().toEqualTypeOf<
      { params?: Record<string, never>; queryOptions?: ReadQueryOptions<Data, Error> } | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof usePools>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof usePools>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
