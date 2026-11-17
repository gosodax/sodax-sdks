/**
 * Compile-time contract: `useXBalances` and its query-options builder read a token-address-to-balance
 * map, typed exactly, from a wallet-layer `xService`.
 */
import type { IXServiceBase, SpokeChainKey, XToken } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from './types.js';
import type { getXBalancesQueryOptions, UseXBalancesParams, useXBalances, XBalancesInputs } from './useXBalances.js';

type Inputs = {
  xService: IXServiceBase | undefined;
  xChainId: SpokeChainKey | undefined;
  xTokens: readonly XToken[];
  address: string | undefined;
};

describe('getXBalancesQueryOptions', () => {
  it('takes the inputs', () => {
    expectTypeOf<XBalancesInputs>().toEqualTypeOf<Inputs>();
    expectTypeOf<Parameters<typeof getXBalancesQueryOptions>>().toEqualTypeOf<[inputs: Inputs]>();
  });

  it('returns the exact query options', () => {
    expectTypeOf<ReturnType<typeof getXBalancesQueryOptions>>().toEqualTypeOf<{
      queryKey: readonly [
        'shared',
        'xBalances',
        SpokeChainKey | undefined,
        (readonly [string, string])[],
        string | undefined,
      ];
      queryFn: () => Promise<Record<string, bigint>>;
      enabled: boolean;
      refetchInterval: number;
    }>();
  });
});

describe('useXBalances', () => {
  it('accepts optional read-hook params', () => {
    expectTypeOf<UseXBalancesParams>().toEqualTypeOf<ReadHookParams<Record<string, bigint>, Inputs>>();
    expectTypeOf<Parameters<typeof useXBalances>>().toEqualTypeOf<
      [params?: ReadHookParams<Record<string, bigint>, Inputs>]
    >();
  });

  it('returns a query of the balance map', () => {
    expectTypeOf<ReturnType<typeof useXBalances>>().toEqualTypeOf<UseQueryResult<Record<string, bigint>, Error>>();
    expectTypeOf<ReturnType<typeof useXBalances>['data']>().toEqualTypeOf<Record<string, bigint> | undefined>();
  });
});
