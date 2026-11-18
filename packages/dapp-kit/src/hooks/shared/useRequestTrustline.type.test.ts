/**
 * Compile-time contract: the deprecated `useRequestTrustline` keeps the exact shape released in 2.0.0.
 */
import type { IStellarWalletProvider, StellarChainKey } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { useRequestTrustline } from './useRequestTrustline.js';

type Vars = { token: string; amount: bigint; srcChainKey: StellarChainKey; walletProvider: IStellarWalletProvider };

describe('useRequestTrustline', () => {
  it('accepts the ignored optional token', () => {
    expectTypeOf<Parameters<typeof useRequestTrustline>>().toEqualTypeOf<[token?: string | undefined]>();
  });

  it('returns the 2.0.0 shape', () => {
    expectTypeOf<ReturnType<typeof useRequestTrustline>>().toEqualTypeOf<{
      requestTrustline: (params: Vars) => Promise<string>;
      isLoading: boolean;
      isRequested: boolean;
      error: Error | null;
      data: string | null;
    }>();
  });
});
