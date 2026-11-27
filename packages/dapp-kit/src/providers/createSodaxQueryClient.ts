import { MutationCache, QueryClient, type QueryClientConfig } from '@tanstack/react-query';

export type CreateSodaxQueryClientOptions = {
  /**
   * Fires on every mutation failure, alongside per-hook `onError`, unless the mutation sets `meta: { silent: true }`.
   * Defaults to `console.error`.
   */
  onMutationError?: (error: unknown) => void;
  config?: QueryClientConfig;
};

const defaultOnMutationError = (error: unknown): void => {
  console.error('[sodax] Mutation error:', error);
};

/** A custom `config.mutationCache` is kept and subscribed to, so its own handlers still fire too. */
export function createSodaxQueryClient({
  onMutationError = defaultOnMutationError,
  config,
}: CreateSodaxQueryClientOptions = {}): QueryClient {
  if (config?.mutationCache) {
    config.mutationCache.subscribe(event => {
      if (event.type === 'updated' && event.action.type === 'error' && event.mutation.options.meta?.silent !== true) {
        onMutationError(event.action.error);
      }
    });
    return new QueryClient(config);
  }

  // No consumer cache: install our own `onError` (cheaper than a subscribe loop).
  return new QueryClient({
    ...config,
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        if (mutation.options.meta?.silent === true) return;
        onMutationError(error);
      },
    }),
  });
}
