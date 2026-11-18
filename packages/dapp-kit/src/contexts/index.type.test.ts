/** Compile-time contract: `SodaxContext` carries the SDK instance, or `null` outside a `SodaxProvider`. */
import type { Sodax } from '@sodax/sdk';
import type { Context } from 'react';
import { describe, expectTypeOf, it } from 'vitest';
import type { SodaxContext, SodaxContextType } from './index.js';

describe('SodaxContext', () => {
  it('is a React context of the SDK holder or null', () => {
    expectTypeOf<SodaxContextType>().toEqualTypeOf<{ sodax: Sodax }>();
    expectTypeOf<typeof SodaxContext>().toEqualTypeOf<Context<{ sodax: Sodax } | null>>();
  });
});
