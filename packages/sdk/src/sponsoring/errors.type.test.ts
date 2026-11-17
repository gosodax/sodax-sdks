/** Pins `classifySponsorError` (EXTERNAL_API_ERROR in, failure class out) and the sponsoring error guards. */
import { describe, expectTypeOf, it } from 'vitest';
import type { SodaxError, SponsorFailureClass } from '../index.js';
import {
  classifySponsorError,
  isSponsoringConfigError,
  isSponsoringLookupError,
  isSponsoringOrchestrationError,
  sponsoringInvariant,
} from './errors.js';

declare const lookupError: SodaxError<'LOOKUP_FAILED'>;

describe('sponsoring/errors', () => {
  it('classifySponsorError returns SponsorFailureClass and only takes EXTERNAL_API_ERROR', () => {
    expectTypeOf<ReturnType<typeof classifySponsorError>>().toEqualTypeOf<SponsorFailureClass>();
    expectTypeOf(classifySponsorError).parameter(0).toEqualTypeOf<SodaxError<'EXTERNAL_API_ERROR'>>();
    // @ts-expect-error — only an EXTERNAL_API_ERROR can be classified
    const invalid = () => classifySponsorError(lookupError);
    expectTypeOf(invalid).toBeFunction();
  });

  it('guards narrow to each per-method error union', () => {
    expectTypeOf(isSponsoringOrchestrationError).guards.toEqualTypeOf<
      SodaxError<
        | 'USER_REJECTED'
        | 'VALIDATION_FAILED'
        | 'INTENT_CREATION_FAILED'
        | 'LOOKUP_FAILED'
        | 'EXTERNAL_API_ERROR'
        | 'EXECUTION_FAILED'
        | 'UNKNOWN'
      >
    >();
    expectTypeOf(isSponsoringConfigError).guards.toEqualTypeOf<
      SodaxError<'EXTERNAL_API_ERROR' | 'VALIDATION_FAILED' | 'UNKNOWN'>
    >();
    expectTypeOf(isSponsoringLookupError).guards.toEqualTypeOf<
      SodaxError<'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'UNKNOWN'>
    >();
  });

  it('sponsoringInvariant narrows its condition', () => {
    const narrowed = (value: string | null | undefined) => {
      sponsoringInvariant(value, 'missing');
      return value;
    };
    expectTypeOf<ReturnType<typeof narrowed>>().toEqualTypeOf<string>();
  });
});
