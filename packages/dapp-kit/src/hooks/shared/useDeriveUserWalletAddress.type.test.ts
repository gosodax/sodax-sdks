/**
 * Compile-time contract: `useDeriveUserWalletAddress` reads the user's hub wallet as a viem `Address`.
 */
import type { SpokeChainKey } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Address } from 'viem';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from './types.js';
import type { useDeriveUserWalletAddress, UseDeriveUserWalletAddressParams } from './useDeriveUserWalletAddress.js';

type Params = ReadHookParams<Address, { spokeChainId?: SpokeChainKey; spokeAddress?: string }>;

describe('useDeriveUserWalletAddress', () => {
  it('accepts optional read-hook params keyed by spoke chain and address', () => {
    expectTypeOf<UseDeriveUserWalletAddressParams>().toEqualTypeOf<Params>();
    expectTypeOf<Parameters<typeof useDeriveUserWalletAddress>>().toEqualTypeOf<[params?: Params]>();
  });

  it('returns a query of the hub wallet address', () => {
    expectTypeOf<ReturnType<typeof useDeriveUserWalletAddress>>().toEqualTypeOf<UseQueryResult<Address, Error>>();
    expectTypeOf<ReturnType<typeof useDeriveUserWalletAddress>['data']>().toEqualTypeOf<Address | undefined>();
  });
});
