/**
 * Compile-time contract: `useFundTradingWallet` resolves to the funding tx id, whose variables accept only a Bitcoin wallet provider.
 */
import type { IBitcoinWalletProvider, IEvmWalletProvider, Result } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useFundTradingWallet, UseFundTradingWalletVars } from './useFundTradingWallet.js';

type Data = string;
type Vars = { amount: bigint; walletProvider: IBitcoinWalletProvider };

declare const mutation: ReturnType<typeof useFundTradingWallet>;
declare const evm: IEvmWalletProvider;

describe('useFundTradingWallet', () => {
  it('takes optional mutation options and returns the exact mutation', () => {
    expectTypeOf<UseFundTradingWalletVars>().toEqualTypeOf<Vars>();
    expectTypeOf<Parameters<typeof useFundTradingWallet>>().toEqualTypeOf<[params?: MutationHookParams<Data, Vars>]>();
    expectTypeOf<ReturnType<typeof useFundTradingWallet>>().toEqualTypeOf<SafeUseMutationResult<Data, Error, Vars>>();
    expectTypeOf<ReturnType<typeof useFundTradingWallet>['data']>().toEqualTypeOf<Data | undefined>();
    expectTypeOf<ReturnType<typeof useFundTradingWallet>['mutateAsyncSafe']>().returns.toEqualTypeOf<
      Promise<Result<Data>>
    >();
  });

  it('rejects a non-Bitcoin wallet provider', () => {
    const wrongProvider = () =>
      // @ts-expect-error — only a Bitcoin wallet can sign for the trading wallet
      mutation.mutate({ amount: 1n, walletProvider: evm });
    expectTypeOf(wrongProvider).toBeFunction();
    expectTypeOf<Vars>().toHaveProperty('walletProvider').toEqualTypeOf<IBitcoinWalletProvider>();
  });
});
