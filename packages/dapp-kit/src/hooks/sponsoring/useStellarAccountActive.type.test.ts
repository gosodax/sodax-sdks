/**
 * Compile-time contract: `useStellarAccountActive` and its query-options builder read whether a Stellar account exists.
 */
import type { Sodax } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type {
  getStellarAccountActiveQueryOptions,
  useStellarAccountActive,
  UseStellarAccountActiveParams,
} from './useStellarAccountActive.js';

type Params = ReadHookParams<boolean, { address: string | undefined }>;

describe('getStellarAccountActiveQueryOptions', () => {
  it('takes a sponsoring reader and an address', () => {
    expectTypeOf<Parameters<typeof getStellarAccountActiveQueryOptions>>().toEqualTypeOf<
      [{ sodax: { sponsoring: Pick<Sodax['sponsoring'], 'isStellarAccountActive'> }; address: string | undefined }]
    >();
    expectTypeOf<{ sodax: Sodax; address: string }>().toExtend<
      Parameters<typeof getStellarAccountActiveQueryOptions>[0]
    >();
  });

  it('returns the exact query options', () => {
    expectTypeOf<ReturnType<typeof getStellarAccountActiveQueryOptions>>().toEqualTypeOf<{
      queryKey: readonly ['sponsoring', 'stellarAccountActive', string | undefined];
      queryFn: () => Promise<boolean>;
      enabled: boolean;
    }>();
  });
});

describe('useStellarAccountActive', () => {
  it('accepts optional read-hook params', () => {
    expectTypeOf<UseStellarAccountActiveParams>().toEqualTypeOf<Params>();
    expectTypeOf<Parameters<typeof useStellarAccountActive>>().toEqualTypeOf<[params?: Params]>();
  });

  it('returns the exact query', () => {
    expectTypeOf<ReturnType<typeof useStellarAccountActive>>().toEqualTypeOf<UseQueryResult<boolean, Error>>();
    expectTypeOf<ReturnType<typeof useStellarAccountActive>['data']>().toEqualTypeOf<boolean | undefined>();
  });
});
