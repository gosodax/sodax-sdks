/**
 * Compile-time contract: `unwrapResult` returns exactly the success type of the `Result` it is given,
 * inferred from the argument, whatever the error type.
 */
import type { Result, SodaxError, StellarAccountStatus } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import { unwrapResult } from './unwrapResult.js';

declare const hash: Result<string>;
declare const status: Result<StellarAccountStatus>;
declare const amounts: Result<readonly bigint[], SodaxError<'LOOKUP_FAILED'>>;
declare const nothing: Result<void>;
declare const maybe: Result<{ id: string } | undefined>;

// Never invoked: the calls exist only for their inferred types.
const calls = () => ({
  hash: unwrapResult(hash),
  status: unwrapResult(status),
  amounts: unwrapResult(amounts),
  nothing: unwrapResult(nothing),
  maybe: unwrapResult(maybe),
});

describe('unwrapResult', () => {
  it('returns the success type of the Result it is given', () => {
    expectTypeOf<ReturnType<typeof calls>['hash']>().toEqualTypeOf<string>();
    expectTypeOf<ReturnType<typeof calls>['status']>().toEqualTypeOf<StellarAccountStatus>();
    expectTypeOf<ReturnType<typeof calls>['amounts']>().toEqualTypeOf<readonly bigint[]>();
    expectTypeOf<ReturnType<typeof calls>['nothing']>().toEqualTypeOf<void>();
    expectTypeOf<ReturnType<typeof calls>['maybe']>().toEqualTypeOf<{ id: string } | undefined>();
  });

  it('accepts only a Result', () => {
    // @ts-expect-error — a bare value is not a Result
    const bare = () => unwrapResult('0xabc');
    // @ts-expect-error — a Promise must be awaited first
    const pending = () => unwrapResult(Promise.resolve(hash));
    expectTypeOf(bare).toBeFunction();
    expectTypeOf(pending).toBeFunction();
  });
});
