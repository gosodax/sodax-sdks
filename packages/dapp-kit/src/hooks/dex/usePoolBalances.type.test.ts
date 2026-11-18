/**
 * Compile-time contract: `usePoolBalances` reads the user's hub balances of both pool tokens, typed exactly, so `data` can never widen to `any`.
 */
import type { PoolData, PoolKey, SpokeChainKey } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { usePoolBalances } from './usePoolBalances.js';

type Data = { token0Balance: bigint; token1Balance: bigint };

describe('usePoolBalances', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof usePoolBalances>[0]>().toEqualTypeOf<
      | {
          params?: {
            poolData: PoolData | null;
            poolKey: PoolKey | null;
            spokeChainKey: SpokeChainKey | undefined;
            userAddress: string | undefined;
          };
          queryOptions?: ReadQueryOptions<Data, Error>;
        }
      | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof usePoolBalances>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof usePoolBalances>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
