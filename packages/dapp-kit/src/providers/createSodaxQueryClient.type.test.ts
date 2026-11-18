/**
 * Compile-time contract: `createSodaxQueryClient` takes optional observability options and returns a
 * React Query `QueryClient`.
 */
import type { QueryClient, QueryClientConfig } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { CreateSodaxQueryClientOptions, createSodaxQueryClient } from './createSodaxQueryClient.js';

type Options = { onMutationError?: (error: unknown) => void; config?: QueryClientConfig };

describe('createSodaxQueryClient', () => {
  it('takes optional options', () => {
    // `unknown` is legitimate: the hook receives whatever a mutation function threw.
    expectTypeOf<CreateSodaxQueryClientOptions>().toEqualTypeOf<Options>();
    expectTypeOf<Parameters<typeof createSodaxQueryClient>>().toEqualTypeOf<[options?: Options]>();
  });

  it('returns a QueryClient', () => {
    expectTypeOf<ReturnType<typeof createSodaxQueryClient>>().toEqualTypeOf<QueryClient>();
  });
});
