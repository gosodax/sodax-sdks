/** Pins useBackendMoneyMarketAssetBorrowers's params and query result, with the response body spelled out so `data` cannot widen. */
import type { MoneyMarketAssetBorrowers } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { BackendPaginationParams } from './types.js';
import type { useBackendMoneyMarketAssetBorrowers } from './useBackendMoneyMarketAssetBorrowers.js';

describe('useBackendMoneyMarketAssetBorrowers', () => {
  it('takes a reserve address and pagination', () => {
    expectTypeOf<Parameters<typeof useBackendMoneyMarketAssetBorrowers>>().toEqualTypeOf<
      [
        {
          params?: { reserveAddress: string | undefined; pagination: BackendPaginationParams };
          queryOptions?: ReadQueryOptions<MoneyMarketAssetBorrowers | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the borrowers page, undefined until its inputs are set', () => {
    expectTypeOf<ReturnType<typeof useBackendMoneyMarketAssetBorrowers>>().toEqualTypeOf<
      UseQueryResult<MoneyMarketAssetBorrowers | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBackendMoneyMarketAssetBorrowers>['data']>>().toEqualTypeOf<{
      borrowers: string[];
      total: number;
      offset: number;
      limit: number;
    }>();
  });
});
