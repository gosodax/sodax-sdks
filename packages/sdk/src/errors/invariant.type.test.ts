/** Pins what `sodaxInvariant` and the `createInvariant` factory's result assert: the condition narrows. */
import { describe, expectTypeOf, it } from 'vitest';
import type { FeatureInvariant } from '../index.js';
import { createInvariant, sodaxInvariant } from './invariant.js';

describe('errors/invariant', () => {
  it('sodaxInvariant narrows its condition', () => {
    const narrowed = (value: string | undefined) => {
      sodaxInvariant(value, 'missing', { feature: 'swap' });
      return value;
    };
    expectTypeOf<ReturnType<typeof narrowed>>().toEqualTypeOf<string>();
    expectTypeOf<ReturnType<typeof sodaxInvariant>>().toBeVoid();
    // @ts-expect-error — feature must be a SodaxFeature
    const invalid = () => sodaxInvariant(true, 'x', { feature: 'lending' });
    expectTypeOf(invalid).toBeFunction();
  });

  it('createInvariant returns a FeatureInvariant whose call narrows', () => {
    expectTypeOf<ReturnType<typeof createInvariant>>().toEqualTypeOf<FeatureInvariant>();
    const narrowed = (value: bigint | null) => {
      const check: FeatureInvariant = createInvariant('moneyMarket');
      check(value, 'missing');
      return value;
    };
    expectTypeOf<ReturnType<typeof narrowed>>().toEqualTypeOf<bigint>();
  });
});
