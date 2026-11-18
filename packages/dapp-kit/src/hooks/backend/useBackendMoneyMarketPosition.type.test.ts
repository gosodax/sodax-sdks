/** Pins useBackendMoneyMarketPosition's params and query result, with the response body spelled out so `data` cannot widen. */
import type { MoneyMarketPosition } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useBackendMoneyMarketPosition } from './useBackendMoneyMarketPosition.js';

describe('useBackendMoneyMarketPosition', () => {
  it('takes a user address', () => {
    expectTypeOf<Parameters<typeof useBackendMoneyMarketPosition>>().toEqualTypeOf<
      [
        {
          params?: { userAddress: string | undefined };
          queryOptions?: ReadQueryOptions<MoneyMarketPosition | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the position, undefined until the user address is set', () => {
    expectTypeOf<ReturnType<typeof useBackendMoneyMarketPosition>>().toEqualTypeOf<
      UseQueryResult<MoneyMarketPosition | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBackendMoneyMarketPosition>['data']>>().toEqualTypeOf<{
      userAddress: string;
      positions: {
        reserveAddress: string;
        aTokenAddress: string;
        variableDebtTokenAddress: string;
        aTokenBalance: string;
        variableDebtTokenBalance: string;
        blockNumber: number;
      }[];
    }>();
  });
});
