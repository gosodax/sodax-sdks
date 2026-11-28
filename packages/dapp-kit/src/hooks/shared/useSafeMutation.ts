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

export type SafeUseMutationResult<TData, TError, TVars, TContext = unknown> = UseMutationResult<
  TData,
  TError,
  TVars,
  TContext
> & {
  /** Like `mutateAsync` but never rejects; resolves to `Result<TData>`. */
  mutateAsyncSafe: (vars: TVars, options?: MutateOptions<TData, TError, TVars, TContext>) => Promise<Result<TData>>;
};

export async function toResult<T>(promise: Promise<T>): Promise<Result<T>> {
  try {
    const value = await promise;
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

/** `useMutation` plus `mutateAsyncSafe`; retries are suppressed once funds may have moved. */
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
