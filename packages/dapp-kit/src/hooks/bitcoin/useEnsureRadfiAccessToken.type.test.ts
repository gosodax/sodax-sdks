/**
 * Compile-time contract: `useEnsureRadfiAccessToken` resolves to a fresh Bound Exchange access token, whose variables accept only a Bitcoin wallet provider.
 */
import type { IBitcoinWalletProvider, IEvmWalletProvider, Result } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useEnsureRadfiAccessToken, UseEnsureRadfiAccessTokenVars } from './useEnsureRadfiAccessToken.js';

type Data = string;
type Vars = { walletProvider: IBitcoinWalletProvider };

declare const mutation: ReturnType<typeof useEnsureRadfiAccessToken>;
declare const evm: IEvmWalletProvider;

describe('useEnsureRadfiAccessToken', () => {
  it('takes optional mutation options and returns the exact mutation', () => {
    expectTypeOf<UseEnsureRadfiAccessTokenVars>().toEqualTypeOf<Vars>();
    expectTypeOf<Parameters<typeof useEnsureRadfiAccessToken>>().toEqualTypeOf<
      [params?: MutationHookParams<Data, Vars>]
    >();
    expectTypeOf<ReturnType<typeof useEnsureRadfiAccessToken>>().toEqualTypeOf<
      SafeUseMutationResult<Data, Error, Vars>
    >();
    expectTypeOf<ReturnType<typeof useEnsureRadfiAccessToken>['data']>().toEqualTypeOf<Data | undefined>();
    expectTypeOf<ReturnType<typeof useEnsureRadfiAccessToken>['mutateAsyncSafe']>().returns.toEqualTypeOf<
      Promise<Result<Data>>
    >();
  });

  it('rejects a non-Bitcoin wallet provider', () => {
    const wrongProvider = () =>
      // @ts-expect-error — only a Bitcoin wallet can sign for the trading wallet
      mutation.mutate({ walletProvider: evm });
    expectTypeOf(wrongProvider).toBeFunction();
    expectTypeOf<Vars>().toHaveProperty('walletProvider').toEqualTypeOf<IBitcoinWalletProvider>();
  });
});
