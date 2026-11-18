/** Pins useBackendMoneyMarketAssetSuppliers's params and query result, with the response body spelled out so `data` cannot widen. */
import type { MoneyMarketAssetSuppliers } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { BackendPaginationParams } from './types.js';
import type { useBackendMoneyMarketAssetSuppliers } from './useBackendMoneyMarketAssetSuppliers.js';

describe('useBackendMoneyMarketAssetSuppliers', () => {
  it('takes a reserve address and pagination', () => {
    expectTypeOf<Parameters<typeof useBackendMoneyMarketAssetSuppliers>>().toEqualTypeOf<
      [
        {
          params?: { reserveAddress: string | undefined; pagination: BackendPaginationParams };
          queryOptions?: ReadQueryOptions<MoneyMarketAssetSuppliers | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the suppliers page, undefined until its inputs are set', () => {
    expectTypeOf<ReturnType<typeof useBackendMoneyMarketAssetSuppliers>>().toEqualTypeOf<
      UseQueryResult<MoneyMarketAssetSuppliers | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBackendMoneyMarketAssetSuppliers>['data']>>().toEqualTypeOf<{
      suppliers: string[];
      total: number;
      offset: number;
      limit: number;
    }>();
  });
});
