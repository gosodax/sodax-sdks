/**
 * Compile-time contract: `useRegisterNearStorage` is a mutation resolving to the `storage_deposit`
 * tx hash, whose variables accept only a NEAR wallet provider.
 */
import type { INearWalletProvider, IStellarWalletProvider, Result } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from './types.js';
import type { UseRegisterNearStorageVars, useRegisterNearStorage } from './useRegisterNearStorage.js';
import type { SafeUseMutationResult } from './useSafeMutation.js';

type Vars = { token: string; accountId: string; walletProvider: INearWalletProvider; deposit?: bigint };

declare const mutation: ReturnType<typeof useRegisterNearStorage>;
declare const stellar: IStellarWalletProvider;

describe('useRegisterNearStorage', () => {
  it('takes optional mutation options and returns a hash mutation', () => {
    expectTypeOf<UseRegisterNearStorageVars>().toEqualTypeOf<Vars>();
    expectTypeOf<Parameters<typeof useRegisterNearStorage>>().toEqualTypeOf<
      [params?: MutationHookParams<string, Vars>]
    >();
    expectTypeOf<ReturnType<typeof useRegisterNearStorage>>().toEqualTypeOf<
      SafeUseMutationResult<string, Error, Vars>
    >();
    expectTypeOf<ReturnType<typeof useRegisterNearStorage>['mutateAsyncSafe']>().returns.toEqualTypeOf<
      Promise<Result<string>>
    >();
  });

  it('rejects a non-NEAR wallet provider', () => {
    const wrongProvider = () =>
      // @ts-expect-error — only a NEAR wallet can sign storage_deposit
      mutation.mutate({ token: 'usdc.near', accountId: 'alice.near', walletProvider: stellar });
    expectTypeOf(wrongProvider).toBeFunction();
  });
});
