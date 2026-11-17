/** Pins `SodaxError.toJSON` (narrowed by the error's code) and the `isSodaxError` guard. */
import { describe, expectTypeOf, it } from 'vitest';
import type { SodaxErrorCode, SodaxErrorJSON } from '../index.js';
import { isSodaxError, type SodaxError } from './SodaxError.js';

describe('SodaxError', () => {
  it('toJSON carries the error code type through', () => {
    expectTypeOf<ReturnType<SodaxError<'LOOKUP_FAILED'>['toJSON']>>().toEqualTypeOf<SodaxErrorJSON<'LOOKUP_FAILED'>>();
    expectTypeOf<ReturnType<SodaxError<'USER_REJECTED' | 'APPROVE_FAILED'>['toJSON']>>().toEqualTypeOf<
      SodaxErrorJSON<'USER_REJECTED' | 'APPROVE_FAILED'>
    >();
    expectTypeOf<ReturnType<SodaxError['toJSON']>>().toEqualTypeOf<SodaxErrorJSON<SodaxErrorCode>>();
    expectTypeOf<ReturnType<SodaxError<'LOOKUP_FAILED'>['toJSON']>['code']>().toEqualTypeOf<'LOOKUP_FAILED'>();
    // `cause` is the caught value the error wraps: legitimately unknown.
    expectTypeOf<ReturnType<SodaxError['toJSON']>['cause']>().toBeUnknown();
  });

  it('isSodaxError narrows to the default SodaxError', () => {
    expectTypeOf(isSodaxError).guards.toEqualTypeOf<SodaxError<SodaxErrorCode>>();
    expectTypeOf(isSodaxError).parameter(0).toBeUnknown();
  });
});
