/**
 * Compile-time contract: `useInstantUnstakeRatio` reads the instant-unstake output amount, typed exactly, so `data` can never widen to `any`.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useInstantUnstakeRatio } from './useInstantUnstakeRatio.js';

type Data = bigint;

describe('useInstantUnstakeRatio', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useInstantUnstakeRatio>[0]>().toEqualTypeOf<
      { params?: { amount: bigint | undefined }; queryOptions?: ReadQueryOptions<Data, Error> } | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof useInstantUnstakeRatio>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useInstantUnstakeRatio>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
