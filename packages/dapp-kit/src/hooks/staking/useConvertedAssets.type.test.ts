/**
 * Compile-time contract: `useConvertedAssets` reads the converted SODA amount, typed exactly, so `data` can never widen to `any`.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useConvertedAssets } from './useConvertedAssets.js';

type Data = bigint;

describe('useConvertedAssets', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useConvertedAssets>[0]>().toEqualTypeOf<
      { params?: { amount: bigint | undefined }; queryOptions?: ReadQueryOptions<Data, Error> } | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof useConvertedAssets>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useConvertedAssets>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
