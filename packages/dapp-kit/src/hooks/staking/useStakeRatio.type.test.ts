/**
 * Compile-time contract: `useStakeRatio` reads the stake ratio pair, typed exactly, so `data` can never widen to `any`.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useStakeRatio } from './useStakeRatio.js';

type Data = [bigint, bigint];

describe('useStakeRatio', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useStakeRatio>[0]>().toEqualTypeOf<
      { params?: { amount: bigint | undefined }; queryOptions?: ReadQueryOptions<Data, Error> } | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof useStakeRatio>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useStakeRatio>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
