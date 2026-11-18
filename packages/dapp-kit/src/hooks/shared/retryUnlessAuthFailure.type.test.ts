/**
 * Compile-time contract: `retryUnlessAuthFailure` fits React Query's `retry` callback slot and
 * returns a plain boolean.
 */
import type { UseQueryOptions } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { retryUnlessAuthFailure } from './retryUnlessAuthFailure.js';

describe('retryUnlessAuthFailure', () => {
  it('takes a failure count and the caught error and returns boolean', () => {
    // `unknown` error is legitimate: React Query hands over whatever the query function threw.
    expectTypeOf<Parameters<typeof retryUnlessAuthFailure>>().toEqualTypeOf<[failureCount: number, error: unknown]>();
    expectTypeOf<ReturnType<typeof retryUnlessAuthFailure>>().toEqualTypeOf<boolean>();
  });

  it('is assignable to a query retry option', () => {
    expectTypeOf<typeof retryUnlessAuthFailure>().toExtend<UseQueryOptions<string, Error>['retry']>();
  });
});
