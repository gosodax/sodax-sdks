/** Pins the guards built by `isFeatureError` / `isCodeMember` (narrowed by their argument) and the auth checks. */
import { describe, expectTypeOf, it } from 'vitest';
import type { SodaxError } from '../index.js';
import { isAuthFailure, isAuthStatus, isCodeMember, isFeatureError } from './guards.js';

declare const lookupCodes: ReadonlySet<'LOOKUP_FAILED'>;
declare const approveCodes: ReadonlySet<'USER_REJECTED' | 'APPROVE_FAILED'>;

describe('errors/guards', () => {
  it('isFeatureError returns a guard narrowed to the given feature', () => {
    const swap = () => isFeatureError('swap');
    const sponsoring = () => isFeatureError('sponsoring');
    expectTypeOf<ReturnType<typeof swap>>().guards.toEqualTypeOf<SodaxError & { feature: 'swap' }>();
    expectTypeOf<ReturnType<typeof sponsoring>>().guards.toEqualTypeOf<SodaxError & { feature: 'sponsoring' }>();
    // @ts-expect-error — not a SodaxFeature
    const invalid = () => isFeatureError('lending');
    expectTypeOf(invalid).toBeFunction();
  });

  it('isCodeMember returns a guard narrowed to the codes in the set', () => {
    const lookup = () => isCodeMember(lookupCodes);
    const approve = () => isCodeMember(approveCodes);
    expectTypeOf<ReturnType<typeof lookup>>().guards.toEqualTypeOf<SodaxError<'LOOKUP_FAILED'>>();
    expectTypeOf<ReturnType<typeof approve>>().guards.toEqualTypeOf<SodaxError<'USER_REJECTED' | 'APPROVE_FAILED'>>();
    // @ts-expect-error — not a SodaxErrorCode
    const invalid = () => isCodeMember(new Set(['NOT_A_CODE' as const]));
    expectTypeOf(invalid).toBeFunction();
  });

  it('isAuthStatus and isAuthFailure return boolean', () => {
    expectTypeOf(isAuthStatus).returns.toEqualTypeOf<boolean>();
    expectTypeOf(isAuthFailure).returns.toEqualTypeOf<boolean>();
  });
});
