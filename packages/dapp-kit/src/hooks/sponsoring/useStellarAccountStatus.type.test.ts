/**
 * Compile-time contract: `useStellarAccountStatus` and its query-options builder read a Stellar account's existence and trustline affordability.
 */
import type { Sodax, StellarAccountStatus } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type {
  getStellarAccountStatusQueryOptions,
  useStellarAccountStatus,
  UseStellarAccountStatusParams,
} from './useStellarAccountStatus.js';

type Params = ReadHookParams<StellarAccountStatus, { address: string | undefined }>;

describe('getStellarAccountStatusQueryOptions', () => {
  it('takes a sponsoring reader and an address', () => {
    expectTypeOf<Parameters<typeof getStellarAccountStatusQueryOptions>>().toEqualTypeOf<
      [{ sodax: { sponsoring: Pick<Sodax['sponsoring'], 'getStellarAccountStatus'> }; address: string | undefined }]
    >();
    expectTypeOf<{ sodax: Sodax; address: string }>().toExtend<
      Parameters<typeof getStellarAccountStatusQueryOptions>[0]
    >();
  });

  it('returns the exact query options', () => {
    expectTypeOf<ReturnType<typeof getStellarAccountStatusQueryOptions>>().toEqualTypeOf<{
      queryKey: readonly ['sponsoring', 'stellarAccountStatus', string | undefined];
      queryFn: () => Promise<StellarAccountStatus>;
      enabled: boolean;
    }>();
  });
});

describe('useStellarAccountStatus', () => {
  it('accepts optional read-hook params', () => {
    expectTypeOf<UseStellarAccountStatusParams>().toEqualTypeOf<Params>();
    expectTypeOf<Parameters<typeof useStellarAccountStatus>>().toEqualTypeOf<[params?: Params]>();
  });

  it('returns the exact query', () => {
    expectTypeOf<ReturnType<typeof useStellarAccountStatus>>().toEqualTypeOf<
      UseQueryResult<StellarAccountStatus, Error>
    >();
    expectTypeOf<ReturnType<typeof useStellarAccountStatus>['data']>().toEqualTypeOf<
      StellarAccountStatus | undefined
    >();
  });
});
