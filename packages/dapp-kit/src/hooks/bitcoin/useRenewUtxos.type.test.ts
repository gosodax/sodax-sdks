/**
 * Compile-time contract: `useRenewUtxos` resolves to the renewal tx id, whose variables accept only a Bitcoin wallet provider.
 */
import type { IBitcoinWalletProvider, IEvmWalletProvider, Result } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useRenewUtxos, UseRenewUtxosVars } from './useRenewUtxos.js';

type Data = string;
type Vars = { txIdVouts: string[]; walletProvider: IBitcoinWalletProvider };

declare const mutation: ReturnType<typeof useRenewUtxos>;
declare const evm: IEvmWalletProvider;

describe('useRenewUtxos', () => {
  it('takes optional mutation options and returns the exact mutation', () => {
    expectTypeOf<UseRenewUtxosVars>().toEqualTypeOf<Vars>();
    expectTypeOf<Parameters<typeof useRenewUtxos>>().toEqualTypeOf<[params?: MutationHookParams<Data, Vars>]>();
    expectTypeOf<ReturnType<typeof useRenewUtxos>>().toEqualTypeOf<SafeUseMutationResult<Data, Error, Vars>>();
    expectTypeOf<ReturnType<typeof useRenewUtxos>['data']>().toEqualTypeOf<Data | undefined>();
    expectTypeOf<ReturnType<typeof useRenewUtxos>['mutateAsyncSafe']>().returns.toEqualTypeOf<Promise<Result<Data>>>();
  });

  it('rejects a non-Bitcoin wallet provider', () => {
    const wrongProvider = () =>
      // @ts-expect-error — only a Bitcoin wallet can sign for the trading wallet
      mutation.mutate({ txIdVouts: ['tx:0'], walletProvider: evm });
    expectTypeOf(wrongProvider).toBeFunction();
    expectTypeOf<Vars>().toHaveProperty('walletProvider').toEqualTypeOf<IBitcoinWalletProvider>();
  });
});
