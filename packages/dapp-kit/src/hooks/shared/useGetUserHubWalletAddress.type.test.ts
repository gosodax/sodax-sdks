/**
 * Compile-time contract: `useGetUserHubWalletAddress` reads the user's hub wallet as a viem `Address`.
 */
import type { SpokeChainKey } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Address } from 'viem';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from './types.js';
import type { useGetUserHubWalletAddress, UseGetUserHubWalletAddressParams } from './useGetUserHubWalletAddress.js';

type Params = ReadHookParams<Address, { spokeChainId?: SpokeChainKey; spokeAddress?: string }>;

describe('useGetUserHubWalletAddress', () => {
  it('accepts optional read-hook params keyed by spoke chain and address', () => {
    expectTypeOf<UseGetUserHubWalletAddressParams>().toEqualTypeOf<Params>();
    expectTypeOf<Parameters<typeof useGetUserHubWalletAddress>>().toEqualTypeOf<[params?: Params]>();
  });

  it('returns a query of the hub wallet address', () => {
    expectTypeOf<ReturnType<typeof useGetUserHubWalletAddress>>().toEqualTypeOf<UseQueryResult<Address, Error>>();
    expectTypeOf<ReturnType<typeof useGetUserHubWalletAddress>['data']>().toEqualTypeOf<Address | undefined>();
  });
});
