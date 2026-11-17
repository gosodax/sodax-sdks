/**
 * Compile-time contract: the shared hook-option aliases are React Query's options minus the keys each hook owns
 * (`queryKey` / `queryFn` / `enabled` for reads, `mutationFn` for mutations), with `Error` / empty params /
 * `unknown` context as defaults.
 */
import type { UseMutationOptions, UseQueryOptions } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookOptions, MutationHookParams, ReadHookParams, ReadQueryOptions } from './types.js';

type CustomError = Error & { code: number };
type Vars = { amount: bigint };
type Ctx = { snapshot: string };
type QueryOptions<TError> = Omit<UseQueryOptions<string, TError>, 'queryKey' | 'queryFn' | 'enabled'>;
type MutationOptions<TError, TContext> = Omit<UseMutationOptions<string, TError, Vars, TContext>, 'mutationFn'>;

describe('ReadQueryOptions', () => {
  it('is UseQueryOptions without the hook-owned keys, with Error as the default error', () => {
    expectTypeOf<ReadQueryOptions<string>>().toEqualTypeOf<QueryOptions<Error>>();
    expectTypeOf<ReadQueryOptions<string, CustomError>>().toEqualTypeOf<QueryOptions<CustomError>>();
  });

  it('accepts behavior knobs but not the hook-owned keys', () => {
    const knobs = (): ReadQueryOptions<string> => ({ staleTime: 1 });
    const enabled = (): ReadQueryOptions<string> => ({
      staleTime: 1,
      // @ts-expect-error — `enabled` is derived by the hook from its required inputs
      enabled: true,
    });
    const queryKey = (): ReadQueryOptions<string> => ({
      staleTime: 1,
      // @ts-expect-error — `queryKey` is owned by the hook
      queryKey: ['custom'],
    });
    const queryFn = (): ReadQueryOptions<string> => ({
      staleTime: 1,
      // @ts-expect-error — `queryFn` is owned by the hook
      queryFn: async () => 'data',
    });
    expectTypeOf(knobs).toBeFunction();
    expectTypeOf(enabled).toBeFunction();
    expectTypeOf(queryKey).toBeFunction();
    expectTypeOf(queryFn).toBeFunction();
  });
});

describe('ReadHookParams', () => {
  it('pairs optional params with optional query options, defaulting to no params and Error', () => {
    expectTypeOf<ReadHookParams<string>>().toEqualTypeOf<{
      params?: Record<string, never>;
      queryOptions?: QueryOptions<Error>;
    }>();
    expectTypeOf<ReadHookParams<string, { address: string }, CustomError>>().toEqualTypeOf<{
      params?: { address: string };
      queryOptions?: QueryOptions<CustomError>;
    }>();
  });
});

describe('MutationHookOptions', () => {
  it('is UseMutationOptions without mutationFn, with Error and unknown context as defaults', () => {
    expectTypeOf<MutationHookOptions<string, Vars>>().toEqualTypeOf<MutationOptions<Error, unknown>>();
    expectTypeOf<MutationHookOptions<string, Vars, CustomError, Ctx>>().toEqualTypeOf<
      MutationOptions<CustomError, Ctx>
    >();
  });

  it('accepts behavior knobs but not mutationFn', () => {
    const knobs = (): MutationHookOptions<string, Vars> => ({ retry: 1 });
    const mutationFn = (): MutationHookOptions<string, Vars> => ({
      retry: 1,
      // @ts-expect-error — `mutationFn` is the hook's SDK integration point
      mutationFn: async () => 'hash',
    });
    expectTypeOf(knobs).toBeFunction();
    expectTypeOf(mutationFn).toBeFunction();
  });
});

describe('MutationHookParams', () => {
  it('wraps the mutation options in one optional key', () => {
    expectTypeOf<MutationHookParams<string, Vars>>().toEqualTypeOf<{
      mutationOptions?: MutationOptions<Error, unknown>;
    }>();
    expectTypeOf<MutationHookParams<string, Vars, CustomError, Ctx>>().toEqualTypeOf<{
      mutationOptions?: MutationOptions<CustomError, Ctx>;
    }>();
  });
});
