/**
 * Compile-time contract: `useBitcoinBalance` reads a BTC balance in satoshis as a bigint.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { UseBitcoinBalanceParams, useBitcoinBalance } from './useBitcoinBalance.js';

type Params = ReadHookParams<bigint, { address: string | undefined; rpcUrl?: string }>;

describe('useBitcoinBalance', () => {
  it('accepts optional read-hook params', () => {
    expectTypeOf<UseBitcoinBalanceParams>().toEqualTypeOf<Params>();
    expectTypeOf<Parameters<typeof useBitcoinBalance>>().toEqualTypeOf<[params?: Params]>();
  });

  it('returns a bigint query', () => {
    expectTypeOf<ReturnType<typeof useBitcoinBalance>>().toEqualTypeOf<UseQueryResult<bigint, Error>>();
    expectTypeOf<ReturnType<typeof useBitcoinBalance>['data']>().toEqualTypeOf<bigint | undefined>();
  });
});
