import type { UseMutationOptions, UseQueryOptions } from '@tanstack/react-query';

/** `enabled` is hook-owned: derived from required-input presence. */
export type ReadQueryOptions<TData, TError = Error> = Omit<
  UseQueryOptions<TData, TError>,
  'queryKey' | 'queryFn' | 'enabled'
>;

export type ReadHookParams<TData, TParams = Record<string, never>, TError = Error> = {
  params?: TParams;
  queryOptions?: ReadQueryOptions<TData, TError>;
};

/**
 * `TData` is the unwrapped success type (hooks throw on SDK failure). A consumer `onSuccess` runs after
 * the hook's own invalidations; the default `mutationKey` is overridable.
 */
export type MutationHookOptions<TData, TVars, TError = Error, TContext = unknown> = Omit<
  UseMutationOptions<TData, TError, TVars, TContext>,
  'mutationFn'
>;

/** Domain inputs belong in `TVars` and flow through `mutate(vars)`, not here. */
export type MutationHookParams<TData, TVars, TError = Error, TContext = unknown> = {
  mutationOptions?: MutationHookOptions<TData, TVars, TError, TContext>;
};
