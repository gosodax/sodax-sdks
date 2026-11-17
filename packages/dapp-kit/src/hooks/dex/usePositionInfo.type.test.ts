/**
 * Compile-time contract: `usePositionInfo` reads the position info and whether it belongs to the pool, typed exactly, so `data` can never widen to `any`.
 */
import type { ClPositionInfo, PoolKey } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { usePositionInfo } from './usePositionInfo.js';

type Data = { positionInfo: ClPositionInfo; isValid: boolean };

describe('usePositionInfo', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof usePositionInfo>[0]>().toEqualTypeOf<
      | { params?: { tokenId: string | null; poolKey: PoolKey | null }; queryOptions?: ReadQueryOptions<Data, Error> }
      | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof usePositionInfo>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof usePositionInfo>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
