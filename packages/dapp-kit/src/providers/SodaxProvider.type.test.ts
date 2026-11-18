/**
 * Compile-time contract: `SodaxProvider` takes children and an optional SDK config and renders a
 * React element.
 */
import type { SodaxOptions } from '@sodax/sdk';
import type { ReactElement, ReactNode } from 'react';
import { describe, expectTypeOf, it } from 'vitest';
import type { SodaxProvider } from './SodaxProvider.js';

describe('SodaxProvider', () => {
  it('takes children and an optional config', () => {
    expectTypeOf<Parameters<typeof SodaxProvider>>().toEqualTypeOf<
      [props: { children: ReactNode; config?: SodaxOptions }]
    >();
  });

  it('returns a React element', () => {
    expectTypeOf<ReturnType<typeof SodaxProvider>>().toEqualTypeOf<ReactElement>();
  });

  it('requires children', () => {
    // @ts-expect-error — children are required
    expectTypeOf<{ config: SodaxOptions }>().toExtend<Parameters<typeof SodaxProvider>[0]>();
  });
});
