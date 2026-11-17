/**
 * Compile-time contract: `useATokensBalances` reads a map of aToken address to balance, typed exactly, so `data` can never widen to `any`.
 */
import type { Address, SpokeChainKey } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useATokensBalances } from './useATokensBalances.js';

type Data = Map<Address, bigint>;

describe('useATokensBalances', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useATokensBalances>[0]>().toEqualTypeOf<
      | {
          params?: {
            aTokens: readonly Address[];
            spokeChainKey: SpokeChainKey | undefined;
            userAddress: string | undefined;
          };
          queryOptions?: ReadQueryOptions<Data, Error>;
        }
      | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof useATokensBalances>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useATokensBalances>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
