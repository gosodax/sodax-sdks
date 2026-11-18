/**
 * Compile-time contract: the Bound Exchange session helpers read and write `RadfiSession`, and
 * `useRadfiAuth` is a mutation resolving to the issued tokens and trading address.
 */
import type { IBitcoinWalletProvider, IEvmWalletProvider, Result } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type {
  clearRadfiSession,
  loadRadfiSession,
  RadfiSession,
  saveRadfiSession,
  UseRadfiAuthVars,
  useRadfiAuth,
} from './useRadfiAuth.js';

type Session = { accessToken: string; refreshToken: string; tradingAddress: string; publicKey: string };
type Data = { accessToken: string; refreshToken: string; tradingAddress: string };
type Vars = { walletProvider: IBitcoinWalletProvider };

declare const mutation: ReturnType<typeof useRadfiAuth>;
declare const evm: IEvmWalletProvider;

describe('session helpers', () => {
  it('pins the persisted session shape', () => {
    expectTypeOf<RadfiSession>().toEqualTypeOf<Session>();
  });

  it('saveRadfiSession stores a full session and returns nothing', () => {
    expectTypeOf<Parameters<typeof saveRadfiSession>>().toEqualTypeOf<[address: string, session: Session]>();
    expectTypeOf<ReturnType<typeof saveRadfiSession>>().toEqualTypeOf<void>();
  });

  it('loadRadfiSession returns the session or null', () => {
    expectTypeOf<Parameters<typeof loadRadfiSession>>().toEqualTypeOf<[address: string]>();
    expectTypeOf<ReturnType<typeof loadRadfiSession>>().toEqualTypeOf<Session | null>();
  });

  it('clearRadfiSession returns nothing', () => {
    expectTypeOf<Parameters<typeof clearRadfiSession>>().toEqualTypeOf<[address: string]>();
    expectTypeOf<ReturnType<typeof clearRadfiSession>>().toEqualTypeOf<void>();
  });
});

describe('useRadfiAuth', () => {
  it('takes optional mutation options and returns the exact mutation', () => {
    expectTypeOf<UseRadfiAuthVars>().toEqualTypeOf<Vars>();
    expectTypeOf<Parameters<typeof useRadfiAuth>>().toEqualTypeOf<[params?: MutationHookParams<Data, Vars>]>();
    expectTypeOf<ReturnType<typeof useRadfiAuth>>().toEqualTypeOf<SafeUseMutationResult<Data, Error, Vars>>();
    expectTypeOf<ReturnType<typeof useRadfiAuth>['mutateAsyncSafe']>().returns.toEqualTypeOf<Promise<Result<Data>>>();
  });

  it('rejects a non-Bitcoin wallet provider', () => {
    const wrongProvider = () =>
      // @ts-expect-error — BIP322 auth needs a Bitcoin wallet
      mutation.mutate({ walletProvider: evm });
    expectTypeOf(wrongProvider).toBeFunction();
  });
});
