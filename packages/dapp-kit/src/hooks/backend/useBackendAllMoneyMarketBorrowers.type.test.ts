/** Pins useBackendAllMoneyMarketBorrowers's params and query result, with the response body spelled out so `data` cannot widen. */
import type { MoneyMarketBorrowers } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { BackendPaginationParams } from './types.js';
import type { useBackendAllMoneyMarketBorrowers } from './useBackendAllMoneyMarketBorrowers.js';

describe('useBackendAllMoneyMarketBorrowers', () => {
  it('takes pagination', () => {
    expectTypeOf<Parameters<typeof useBackendAllMoneyMarketBorrowers>>().toEqualTypeOf<
      [
        {
          params?: { pagination: BackendPaginationParams };
          queryOptions?: ReadQueryOptions<MoneyMarketBorrowers | undefined>;
        }?,
      ]
    >();
    expectTypeOf<BackendPaginationParams>().toEqualTypeOf<{ offset: string; limit: string }>();
  });

  it('resolves to the borrowers page, undefined until pagination is set', () => {
    expectTypeOf<ReturnType<typeof useBackendAllMoneyMarketBorrowers>>().toEqualTypeOf<
      UseQueryResult<MoneyMarketBorrowers | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBackendAllMoneyMarketBorrowers>['data']>>().toEqualTypeOf<{
      borrowers: string[];
      total: number;
      offset: number;
      limit: number;
    }>();
  });
});
