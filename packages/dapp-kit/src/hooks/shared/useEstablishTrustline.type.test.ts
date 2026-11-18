/**
 * Compile-time contract: `useEstablishTrustline` is a mutation resolving to the trustline tx hash,
 * whose variables accept only a Stellar chain key and a Stellar wallet provider.
 */
import type { IEvmWalletProvider, IStellarWalletProvider, Result, StellarChainKey } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from './types.js';
import type { UseEstablishTrustlineVars, useEstablishTrustline } from './useEstablishTrustline.js';
import type { SafeUseMutationResult } from './useSafeMutation.js';

type Vars = { token: string; amount: bigint; srcChainKey: StellarChainKey; walletProvider: IStellarWalletProvider };

declare const mutation: ReturnType<typeof useEstablishTrustline>;
declare const stellar: IStellarWalletProvider;
declare const evm: IEvmWalletProvider;

describe('useEstablishTrustline', () => {
  it('takes optional mutation options and returns a hash mutation', () => {
    expectTypeOf<UseEstablishTrustlineVars>().toEqualTypeOf<Vars>();
    expectTypeOf<Parameters<typeof useEstablishTrustline>>().toEqualTypeOf<
      [params?: MutationHookParams<string, Vars>]
    >();
    expectTypeOf<ReturnType<typeof useEstablishTrustline>>().toEqualTypeOf<
      SafeUseMutationResult<string, Error, Vars>
    >();
    expectTypeOf<ReturnType<typeof useEstablishTrustline>['mutateAsyncSafe']>().returns.toEqualTypeOf<
      Promise<Result<string>>
    >();
  });

  it('rejects a non-Stellar wallet provider or chain', () => {
    const wrongProvider = () =>
      // @ts-expect-error — an EVM wallet cannot sign a Stellar trustline
      mutation.mutate({ token: 'USDC', amount: 1n, srcChainKey: 'stellar', walletProvider: evm });
    const wrongChain = () =>
      // @ts-expect-error — trustlines exist only on Stellar
      mutation.mutate({ token: 'USDC', amount: 1n, srcChainKey: '0x38.bsc', walletProvider: stellar });
    expectTypeOf(wrongProvider).toBeFunction();
    expectTypeOf(wrongChain).toBeFunction();
  });
});
