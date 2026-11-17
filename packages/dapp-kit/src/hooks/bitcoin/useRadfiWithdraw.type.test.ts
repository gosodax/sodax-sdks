/**
 * Compile-time contract: `useRadfiWithdraw` resolves to the withdrawal tx id and fee, whose variables accept only a Bitcoin wallet provider.
 */
import type { IBitcoinWalletProvider, IEvmWalletProvider, Result } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useRadfiWithdraw, UseRadfiWithdrawVars } from './useRadfiWithdraw.js';

type Data = { txId: string; fee: number };
type Vars = { amount: string; tokenId: string; withdrawTo: string; walletProvider: IBitcoinWalletProvider };

declare const mutation: ReturnType<typeof useRadfiWithdraw>;
declare const evm: IEvmWalletProvider;

describe('useRadfiWithdraw', () => {
  it('takes optional mutation options and returns the exact mutation', () => {
    expectTypeOf<UseRadfiWithdrawVars>().toEqualTypeOf<Vars>();
    expectTypeOf<Parameters<typeof useRadfiWithdraw>>().toEqualTypeOf<[params?: MutationHookParams<Data, Vars>]>();
    expectTypeOf<ReturnType<typeof useRadfiWithdraw>>().toEqualTypeOf<SafeUseMutationResult<Data, Error, Vars>>();
    expectTypeOf<ReturnType<typeof useRadfiWithdraw>['data']>().toEqualTypeOf<Data | undefined>();
    expectTypeOf<ReturnType<typeof useRadfiWithdraw>['mutateAsyncSafe']>().returns.toEqualTypeOf<
      Promise<Result<Data>>
    >();
  });

  it('rejects a non-Bitcoin wallet provider', () => {
    const wrongProvider = () =>
      // @ts-expect-error — only a Bitcoin wallet can sign for the trading wallet
      mutation.mutate({ amount: '1', tokenId: '0:0', withdrawTo: 'bc1q', walletProvider: evm });
    expectTypeOf(wrongProvider).toBeFunction();
    expectTypeOf<Vars>().toHaveProperty('walletProvider').toEqualTypeOf<IBitcoinWalletProvider>();
  });
});
