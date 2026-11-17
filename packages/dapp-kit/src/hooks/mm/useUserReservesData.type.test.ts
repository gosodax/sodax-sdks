/**
 * Compile-time contract: `useUserReservesData` reads the user's raw reserves and eMode id, typed exactly, so `data` can never widen to `any`.
 */
import type { SpokeChainKey, UserReserveData } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useUserReservesData } from './useUserReservesData.js';

type Data = readonly [readonly UserReserveData[], number];

describe('useUserReservesData', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useUserReservesData>[0]>().toEqualTypeOf<
      | {
          params?: { spokeChainKey: SpokeChainKey | undefined; userAddress: string | undefined };
          queryOptions?: ReadQueryOptions<Data, Error>;
        }
      | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof useUserReservesData>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useUserReservesData>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
