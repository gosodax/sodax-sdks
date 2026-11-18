/** Pins useBackendAllMoneyMarketAssets's params and query result, with the response body spelled out so `data` cannot widen. */
import type { MoneyMarketAsset } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useBackendAllMoneyMarketAssets } from './useBackendAllMoneyMarketAssets.js';

describe('useBackendAllMoneyMarketAssets', () => {
  it('takes no domain params', () => {
    expectTypeOf<Parameters<typeof useBackendAllMoneyMarketAssets>>().toEqualTypeOf<
      [{ params?: Record<string, never>; queryOptions?: ReadQueryOptions<MoneyMarketAsset[]> }?]
    >();
  });

  it('resolves to every money market asset', () => {
    expectTypeOf<ReturnType<typeof useBackendAllMoneyMarketAssets>>().toEqualTypeOf<
      UseQueryResult<MoneyMarketAsset[], Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBackendAllMoneyMarketAssets>['data']>[number]>().toEqualTypeOf<{
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
