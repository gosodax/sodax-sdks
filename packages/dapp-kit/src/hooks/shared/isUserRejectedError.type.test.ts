/**
 * Compile-time contract: `isUserRejectedError` accepts any caught value and returns a plain boolean
 * (it is not a type guard today).
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { isUserRejectedError } from './isUserRejectedError.js';

describe('isUserRejectedError', () => {
  it('takes an unknown caught value and returns boolean', () => {
    // `unknown` input is legitimate: it receives whatever a mutation or catch block rejected with.
    expectTypeOf<Parameters<typeof isUserRejectedError>>().toEqualTypeOf<[error: unknown]>();
    expectTypeOf<ReturnType<typeof isUserRejectedError>>().toEqualTypeOf<boolean>();
  });
});
