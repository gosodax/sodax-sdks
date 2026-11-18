/**
 * Compile-time contract: `useHubProvider` returns the SDK's EVM hub provider.
 */
import type { EvmHubProvider } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { useHubProvider } from './useHubProvider.js';

describe('useHubProvider', () => {
  it('takes no arguments and returns the hub provider', () => {
    expectTypeOf<Parameters<typeof useHubProvider>>().toEqualTypeOf<[]>();
    expectTypeOf<ReturnType<typeof useHubProvider>>().toEqualTypeOf<EvmHubProvider>();
  });
});
