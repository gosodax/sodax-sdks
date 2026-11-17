/**
 * Compile-time contract: `useRadfiSession` takes an optional Bitcoin wallet provider and returns the
 * session state with a `login` action.
 */
import type { IBitcoinWalletProvider } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { UseRadfiSessionReturn, useRadfiSession } from './useRadfiSession.js';

type Session = {
  walletAddress: string | undefined;
  isAuthed: boolean;
  tradingAddress: string | undefined;
  login: () => Promise<void>;
  isLoginPending: boolean;
};

describe('useRadfiSession', () => {
  it('takes a Bitcoin wallet provider or undefined', () => {
    expectTypeOf<Parameters<typeof useRadfiSession>>().toEqualTypeOf<
      [walletProvider: IBitcoinWalletProvider | undefined]
    >();
  });

  it('returns the session state', () => {
    expectTypeOf<UseRadfiSessionReturn>().toEqualTypeOf<Session>();
    expectTypeOf<ReturnType<typeof useRadfiSession>>().toEqualTypeOf<Session>();
  });
});
