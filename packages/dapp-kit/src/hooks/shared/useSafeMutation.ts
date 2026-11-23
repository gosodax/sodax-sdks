// packages/dapp-kit/src/hooks/shared/useSafeMutation.ts
import type { Result } from '@sodax/sdk';
import {
  useMutation,
  useQueryClient,
  type MutateOptions,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import { retryBeforeSubmission } from './retryBeforeSubmission.js';

/**
 * Return shape of every dapp-kit mutation hook. Extends `UseMutationResult` with one extra
 * method, `mutateAsyncSafe`, that never rejects — it returns the SDK's `Result<T>` shape so
 * callers can branch on `.ok` without `try/catch`.
 *
 * The underlying `mutationFn` still throws on SDK failure, so React Query's native error model
 * (`isError`, `error`, `onError`, `retry`, `throwOnError`, devtools) keeps working as documented.
 */
export type SafeUseMutationResult<TData, TError, TVars, TContext = unknown> = UseMutationResult<
  TData,
  TError,
  TVars,
  TContext
> & {
  /**
   * Like `mutateAsync` but never rejects. Returns `Result<TData>` so callers can branch
   * on `.ok` without `try/catch`.
   *
   * Use this for imperative flows where rejection-style errors are awkward — e.g. sequential
   * `if (!hasAllowance) await approve(...); await action(...)` chains where the user-reject
   * case is the modal failure mode, not an exceptional one.
   */
  mutateAsyncSafe: (vars: TVars, options?: MutateOptions<TData, TError, TVars, TContext>) => Promise<Result<TData>>;
};

/**
 * Wraps a `Promise<T>` (typically `mutateAsync(vars)`) into a `Promise<Result<T>>` that never
 * rejects. Pure, side-effect-free — extracted for unit testing.
 */
export async function toResult<T>(promise: Promise<T>): Promise<Result<T>> {
  try {
    const value = await promise;
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Drop-in replacement for `useMutation` that augments the result with `mutateAsyncSafe`. Used
 * by every dapp-kit mutation hook so consumers can pick rejection-style (`mutateAsync`) or
 * Result-style (`mutateAsyncSafe`) ergonomics without the hook author having to think about it.
 */
export function useSafeMutation<TData, TError, TVars, TContext = unknown>(
  options: UseMutationOptions<TData, TError, TVars, TContext>,
): SafeUseMutationResult<TData, TError, TVars, TContext> {
  const queryClient = useQueryClient();
  const { retry } = queryClient.defaultMutationOptions(options);
  const mutation = useMutation<TData, TError, TVars, TContext>({
    ...options,
    retry: retryBeforeSubmission(retry),
  });
  const { mutateAsync } = mutation;
  const mutateAsyncSafe = useCallback(
    (vars: TVars, opts?: MutateOptions<TData, TError, TVars, TContext>): Promise<Result<TData>> =>
      toResult(mutateAsync(vars, opts)),
    [mutateAsync],
  );
  return { ...mutation, mutateAsyncSafe };
}
