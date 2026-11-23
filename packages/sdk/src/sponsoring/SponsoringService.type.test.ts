/** Pins every public `SponsoringService` method to its success value and narrow per-method error union. */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  ActivateStellarAccountResult,
  Result,
  SodaxError,
  StellarAccountStatus,
  StellarSponsorConfig,
} from '../index.js';
import type { SponsoringService } from './SponsoringService.js';

type LookupError = SodaxError<'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'UNKNOWN'>;

describe('SponsoringService', () => {
  it('read methods', () => {
    expectTypeOf<ReturnType<SponsoringService['isStellarAccountActive']>>().toEqualTypeOf<
      Promise<Result<boolean, LookupError>>
    >();
    expectTypeOf<ReturnType<SponsoringService['getStellarAccountStatus']>>().toEqualTypeOf<
      Promise<Result<StellarAccountStatus, LookupError>>
    >();
    expectTypeOf<ReturnType<SponsoringService['getStellarSponsorConfig']>>().toEqualTypeOf<
      Promise<Result<StellarSponsorConfig, SodaxError<'EXTERNAL_API_ERROR' | 'VALIDATION_FAILED' | 'UNKNOWN'>>>
    >();
    expectTypeOf<StellarAccountStatus>().toEqualTypeOf<{
      exists: boolean;
      nativeBalanceStroops: bigint;
      availableBalanceStroops: bigint;
      canAffordTrustline: boolean;
      trustlineMinXlmStroops: bigint;
    }>();
  });

  it('activateStellarAccount', () => {
    expectTypeOf<ReturnType<SponsoringService['activateStellarAccount']>>().toEqualTypeOf<
      Promise<
        Result<
          ActivateStellarAccountResult,
          SodaxError<
            | 'USER_REJECTED'
            | 'VALIDATION_FAILED'
            | 'INTENT_CREATION_FAILED'
            | 'LOOKUP_FAILED'
            | 'EXTERNAL_API_ERROR'
            | 'EXECUTION_FAILED'
            | 'UNKNOWN'
          >
        >
      >
    >();
    expectTypeOf<ActivateStellarAccountResult>().toEqualTypeOf<
      | { status: 'submitted'; hash: string; attempts: 1 | 2 }
      | { status: 'alreadyActive'; hash: null; attempts: 0 | 1 | 2 }
    >();
  });
});
