/**
 * Compile-time contract: `useTradingWalletBalance` reads the trading wallet balance from Bound Exchange.
 */
import type { IBitcoinWalletProvider, RadfiWalletBalance } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useTradingWalletBalance, UseTradingWalletBalanceParams } from './useTradingWalletBalance.js';

type Params = ReadHookParams<
  RadfiWalletBalance,
  { walletProvider: IBitcoinWalletProvider | undefined; tradingAddress: string | undefined }
>;

describe('useTradingWalletBalance', () => {
  it('accepts optional read-hook params', () => {
    expectTypeOf<UseTradingWalletBalanceParams>().toEqualTypeOf<Params>();
    expectTypeOf<Parameters<typeof useTradingWalletBalance>>().toEqualTypeOf<[params?: Params]>();
  });

  it('returns the exact query', () => {
    expectTypeOf<ReturnType<typeof useTradingWalletBalance>>().toEqualTypeOf<
      UseQueryResult<RadfiWalletBalance, Error>
    >();
    expectTypeOf<ReturnType<typeof useTradingWalletBalance>['data']>().toEqualTypeOf<RadfiWalletBalance | undefined>();
  });
});
