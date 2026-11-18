/**
 * Compile-time contract: `useBalances` and its query-options builder read a token-address-to-balance
 * map, typed exactly, from the SDK-backed balance reader.
 */
import type { Sodax, SpokeChainKey, XToken } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from './types.js';
import type { BalancesInputs, getBalancesQueryOptions, UseBalancesParams, useBalances } from './useBalances.js';

type Inputs = { chainKey: SpokeChainKey | undefined; tokens: readonly XToken[]; address: string | undefined };

describe('getBalancesQueryOptions', () => {
  it('takes the SDK and the inputs', () => {
    expectTypeOf<BalancesInputs>().toEqualTypeOf<Inputs>();
    expectTypeOf<Parameters<typeof getBalancesQueryOptions>>().toEqualTypeOf<[sodax: Sodax, inputs: Inputs]>();
  });

  it('returns the exact query options', () => {
    expectTypeOf<ReturnType<typeof getBalancesQueryOptions>>().toEqualTypeOf<{
      queryKey: readonly [
        'shared',
        'balances',
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

describe('useBalances', () => {
  it('accepts optional read-hook params', () => {
    expectTypeOf<UseBalancesParams>().toEqualTypeOf<ReadHookParams<Record<string, bigint>, Inputs>>();
    expectTypeOf<Parameters<typeof useBalances>>().toEqualTypeOf<
      [params?: ReadHookParams<Record<string, bigint>, Inputs>]
    >();
  });

  it('returns a query of the balance map', () => {
    expectTypeOf<ReturnType<typeof useBalances>>().toEqualTypeOf<UseQueryResult<Record<string, bigint>, Error>>();
    expectTypeOf<ReturnType<typeof useBalances>['data']>().toEqualTypeOf<Record<string, bigint> | undefined>();
  });
});
