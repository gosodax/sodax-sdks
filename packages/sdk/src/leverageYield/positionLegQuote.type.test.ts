/** Compile-time contract: the no-route classifier is a plain boolean, not a type guard. */
import { describe, expectTypeOf, it } from 'vitest';
import type { isNoRouteRefusal } from './positionLegQuote.js';

describe('positionLegQuote result types', () => {
  it('isNoRouteRefusal → boolean', () => {
    expectTypeOf<ReturnType<typeof isNoRouteRefusal>>().toEqualTypeOf<boolean>();
    expectTypeOf<Parameters<typeof isNoRouteRefusal>>().toEqualTypeOf<[error: unknown]>();
  });
});
