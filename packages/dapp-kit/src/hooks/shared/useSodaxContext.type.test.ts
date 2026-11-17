/**
 * Compile-time contract: `useSodaxContext` returns the non-null context holding the SDK instance.
 */
import type { Sodax } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { useSodaxContext } from './useSodaxContext.js';

describe('useSodaxContext', () => {
  it('takes no arguments and returns the SDK context, never null', () => {
    expectTypeOf<Parameters<typeof useSodaxContext>>().toEqualTypeOf<[]>();
    expectTypeOf<ReturnType<typeof useSodaxContext>>().toEqualTypeOf<{ sodax: Sodax }>();
  });
});
