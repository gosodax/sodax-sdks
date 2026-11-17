/**
 * Compile-time contract: `useSponsorConfig` and its query-options builder read the sponsor config.
 */
import type { Sodax, StellarSponsorConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { getSponsorConfigQueryOptions, UseSponsorConfigParams, useSponsorConfig } from './useSponsorConfig.js';

describe('getSponsorConfigQueryOptions', () => {
  it('takes a sponsor-config reader', () => {
    expectTypeOf<Parameters<typeof getSponsorConfigQueryOptions>>().toEqualTypeOf<
      [{ sodax: { sponsoring: Pick<Sodax['sponsoring'], 'getStellarSponsorConfig'> } }]
    >();
    expectTypeOf<{ sodax: Sodax }>().toExtend<Parameters<typeof getSponsorConfigQueryOptions>[0]>();
  });

  it('returns the exact query options', () => {
    expectTypeOf<ReturnType<typeof getSponsorConfigQueryOptions>>().toEqualTypeOf<{
      queryKey: readonly ['sponsoring', 'sponsorConfig'];
      queryFn: () => Promise<StellarSponsorConfig>;
      staleTime: number;
    }>();
  });
});

describe('useSponsorConfig', () => {
  it('accepts optional query options only', () => {
    expectTypeOf<UseSponsorConfigParams>().toEqualTypeOf<ReadHookParams<StellarSponsorConfig>>();
    expectTypeOf<Parameters<typeof useSponsorConfig>>().toEqualTypeOf<
      [params?: ReadHookParams<StellarSponsorConfig, Record<string, never>>]
    >();
  });

  it('returns a query of the sponsor config', () => {
    expectTypeOf<ReturnType<typeof useSponsorConfig>>().toEqualTypeOf<UseQueryResult<StellarSponsorConfig, Error>>();
  });
});
