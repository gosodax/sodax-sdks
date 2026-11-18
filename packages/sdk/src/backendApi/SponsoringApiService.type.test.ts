/**
 * Compile-time contract for `SponsoringApiService`: both Stellar sponsoring endpoints resolve to their
 * exact response type with the narrowed `SodaxError<'EXTERNAL_API_ERROR'>` failure.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { Result, SodaxError, StellarSponsoredAccountResponse, StellarSponsorConfig } from '../index.js';
import type { SponsoringApiService } from './SponsoringApiService.js';

type Svc = SponsoringApiService;
type R<T> = Promise<Result<T, SodaxError<'EXTERNAL_API_ERROR'>>>;

describe('SponsoringApiService', () => {
  it('Stellar sponsoring endpoints', () => {
    expectTypeOf<ReturnType<Svc['getStellarSponsorConfig']>>().toEqualTypeOf<R<StellarSponsorConfig>>();
    expectTypeOf<ReturnType<Svc['createStellarSponsoredAccount']>>().toEqualTypeOf<
      R<StellarSponsoredAccountResponse>
    >();
    // The hash/alreadyActive correlation survives into the public response type.
    expectTypeOf<StellarSponsoredAccountResponse>().toEqualTypeOf<
      { hash: string; alreadyActive: false } | { hash: null; alreadyActive: true }
    >();
  });

  it('header and URL accessors', () => {
    expectTypeOf<ReturnType<Svc['setHeaders']>>().toEqualTypeOf<void>();
    expectTypeOf<ReturnType<Svc['getBaseURL']>>().toEqualTypeOf<string>();
  });
});
