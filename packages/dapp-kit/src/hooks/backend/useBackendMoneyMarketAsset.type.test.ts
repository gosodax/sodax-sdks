/** Pins useBackendMoneyMarketAsset's params and query result, with the response body spelled out so `data` cannot widen. */
import type { MoneyMarketAsset } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useBackendMoneyMarketAsset } from './useBackendMoneyMarketAsset.js';

describe('useBackendMoneyMarketAsset', () => {
  it('takes a reserve address', () => {
    expectTypeOf<Parameters<typeof useBackendMoneyMarketAsset>>().toEqualTypeOf<
      [
        {
          params?: { reserveAddress: string | undefined };
          queryOptions?: ReadQueryOptions<MoneyMarketAsset | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the asset, undefined until the reserve address is set', () => {
    expectTypeOf<ReturnType<typeof useBackendMoneyMarketAsset>>().toEqualTypeOf<
      UseQueryResult<MoneyMarketAsset | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBackendMoneyMarketAsset>['data']>>().toEqualTypeOf<{
      reserveAddress: string;
      aTokenAddress: string;
      totalATokenBalance: string;
      variableDebtTokenAddress: string;
      totalVariableDebtTokenBalance: string;
      liquidityRate: string;
      symbol: string;
      totalSuppliers: number;
      totalBorrowers: number;
      variableBorrowRate: string;
      stableBorrowRate: string;
      liquidityIndex: string;
      variableBorrowIndex: string;
      blockNumber: number;
    }>();
  });
});
