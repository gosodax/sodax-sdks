/**
 * Compile-time contract: `useActivateStellarAccount` is a mutation resolving to the activation
 * outcome, whose variables accept only a Stellar wallet provider.
 */
import type {
  ActivateStellarAccountParams,
  ActivateStellarAccountResult,
  IEvmWalletProvider,
  IStellarWalletProvider,
  Result,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { UseActivateStellarAccountVars, useActivateStellarAccount } from './useActivateStellarAccount.js';

type Data = ActivateStellarAccountResult;
type Vars = ActivateStellarAccountParams;

declare const mutation: ReturnType<typeof useActivateStellarAccount>;
declare const evm: IEvmWalletProvider;

describe('useActivateStellarAccount', () => {
  it('aliases the SDK operation types', () => {
    expectTypeOf<Data>().toEqualTypeOf<
      | { status: 'submitted'; hash: string; attempts: 1 | 2 }
      | { status: 'alreadyActive'; hash: null; attempts: 0 | 1 | 2 }
    >();
    expectTypeOf<Vars['walletProvider']>().toEqualTypeOf<IStellarWalletProvider>();
  });

  it('takes optional mutation options and returns the exact mutation', () => {
    expectTypeOf<UseActivateStellarAccountVars>().toEqualTypeOf<Vars>();
    expectTypeOf<Parameters<typeof useActivateStellarAccount>>().toEqualTypeOf<
      [params?: MutationHookParams<Data, Vars>]
    >();
    expectTypeOf<ReturnType<typeof useActivateStellarAccount>>().toEqualTypeOf<
      SafeUseMutationResult<Data, Error, Vars>
    >();
    expectTypeOf<ReturnType<typeof useActivateStellarAccount>['mutateAsyncSafe']>().returns.toEqualTypeOf<
      Promise<Result<Data>>
    >();
  });

  it('rejects a non-Stellar wallet provider', () => {
    const wrongProvider = () =>
      // @ts-expect-error — only the Stellar account being created can sign its activation
      mutation.mutate({ address: 'G...', walletProvider: evm });
    expectTypeOf(wrongProvider).toBeFunction();
  });
});
