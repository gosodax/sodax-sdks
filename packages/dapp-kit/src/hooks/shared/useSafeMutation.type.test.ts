/**
 * Compile-time contract: `toResult` wraps exactly the awaited type, and `useSafeMutation` carries the
 * data, error, variables and context types of its options through to the result, `mutateAsyncSafe`
 * included, for any input types, inferred from the options.
 */
import type { IStellarWalletProvider, Result, StellarAccountStatus } from '@sodax/sdk';
import type { MutateOptions, UseMutationResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import { type SafeUseMutationResult, toResult, useSafeMutation } from './useSafeMutation.js';

type HashVars = { token: string; amount: bigint };
type StatusVars = { address: string; walletProvider: IStellarWalletProvider };
type StatusContext = { startedAt: number };

declare const hashPromise: Promise<string>;
declare const statusPromise: Promise<StellarAccountStatus>;
declare const hashFn: (vars: HashVars) => Promise<string>;
declare const statusFn: (vars: StatusVars) => Promise<StellarAccountStatus>;

// Never invoked: the calls exist only for their inferred types.
const toResultCalls = () => ({
  hash: toResult(hashPromise),
  status: toResult(statusPromise),
  nothing: toResult(Promise.resolve()),
});

function useHashProbe() {
  return useSafeMutation({ mutationFn: hashFn });
}

function useStatusProbe() {
  return useSafeMutation<StellarAccountStatus, Error, StatusVars, StatusContext>({
    mutationFn: statusFn,
    onMutate: () => ({ startedAt: 0 }),
  });
}

function useInferredContextProbe() {
  return useSafeMutation({
    mutationFn: statusFn,
    onMutate: (): StatusContext => ({ startedAt: 0 }),
  });
}

describe('toResult', () => {
  it('resolves to a Result of the awaited value, never rejecting', () => {
    expectTypeOf<ReturnType<typeof toResultCalls>['hash']>().toEqualTypeOf<Promise<Result<string>>>();
    expectTypeOf<ReturnType<typeof toResultCalls>['status']>().toEqualTypeOf<Promise<Result<StellarAccountStatus>>>();
    expectTypeOf<ReturnType<typeof toResultCalls>['nothing']>().toEqualTypeOf<Promise<Result<void>>>();
  });

  it('accepts only a Promise', () => {
    // @ts-expect-error — a settled value is not a Promise
    const settled = () => toResult('0xabc');
    expectTypeOf(settled).toBeFunction();
  });
});

describe('useSafeMutation', () => {
  it('infers data and variables from mutationFn, with an unknown error and context by default', () => {
    // React Query infers TError as `unknown` from options that never name it; a caught value is unknowable.
    expectTypeOf<ReturnType<typeof useHashProbe>>().toEqualTypeOf<
      SafeUseMutationResult<string, unknown, HashVars, unknown>
    >();
    expectTypeOf<ReturnType<typeof useHashProbe>['data']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ReturnType<typeof useHashProbe>['variables']>().toEqualTypeOf<HashVars | undefined>();
  });

  it('keeps explicit data, error, variables and context exact', () => {
    type R = ReturnType<typeof useStatusProbe>;
    expectTypeOf<R>().toEqualTypeOf<SafeUseMutationResult<StellarAccountStatus, Error, StatusVars, StatusContext>>();
    expectTypeOf<R['data']>().toEqualTypeOf<StellarAccountStatus | undefined>();
    expectTypeOf<R['error']>().toEqualTypeOf<Error | null>();
    expectTypeOf<R['variables']>().toEqualTypeOf<StatusVars | undefined>();
    expectTypeOf<R['context']>().toEqualTypeOf<StatusContext | undefined>();
    expectTypeOf<R['mutateAsync']>().toEqualTypeOf<
      (
        vars: StatusVars,
        options?: MutateOptions<StellarAccountStatus, Error, StatusVars, StatusContext>,
      ) => Promise<StellarAccountStatus>
    >();
    expectTypeOf<R['mutateAsyncSafe']>().toEqualTypeOf<
      (
        vars: StatusVars,
        options?: MutateOptions<StellarAccountStatus, Error, StatusVars, StatusContext>,
      ) => Promise<Result<StellarAccountStatus>>
    >();
  });

  it('infers the context from onMutate', () => {
    expectTypeOf<ReturnType<typeof useInferredContextProbe>>().toEqualTypeOf<
      SafeUseMutationResult<StellarAccountStatus, unknown, StatusVars, StatusContext>
    >();
  });

  it('is a UseMutationResult plus mutateAsyncSafe', () => {
    expectTypeOf<SafeUseMutationResult<string, Error, HashVars>>().toEqualTypeOf<
      UseMutationResult<string, Error, HashVars, unknown> & {
        mutateAsyncSafe: (
          vars: HashVars,
          options?: MutateOptions<string, Error, HashVars, unknown>,
        ) => Promise<Result<string>>;
      }
    >();
  });

  it('rejects options whose mutationFn disagrees with the declared types', () => {
    function useMismatchProbe() {
      // @ts-expect-error — mutationFn resolves to a string, not the declared StellarAccountStatus
      return useSafeMutation<StellarAccountStatus, Error, HashVars>({ mutationFn: hashFn });
    }
    expectTypeOf(useMismatchProbe).toBeFunction();
  });
});
