/** Pins what `invariant` and `assertOk` assert: the condition narrows after the call. */
import { describe, expectTypeOf, it } from 'vitest';
import { assertOk, invariant } from './tiny-invariant.js';

describe('shared/utils/tiny-invariant', () => {
  it('invariant narrows its condition', () => {
    const narrowed = (value: string | undefined) => {
      invariant(value, 'missing');
      return value;
    };
    const unionNarrowed = (value: number | null) => {
      invariant(value);
      return value;
    };
    expectTypeOf<ReturnType<typeof narrowed>>().toEqualTypeOf<string>();
    expectTypeOf<ReturnType<typeof unionNarrowed>>().toEqualTypeOf<number>();
  });

  it('assertOk narrows its condition and requires an Error factory', () => {
    const narrowed = (value: bigint | undefined) => {
      assertOk(value, () => new TypeError('missing'));
      return value;
    };
    expectTypeOf<ReturnType<typeof narrowed>>().toEqualTypeOf<bigint>();
    // @ts-expect-error — the factory must build an Error
    const invalid = () => assertOk(true, () => 'not an error');
    expectTypeOf(invalid).toBeFunction();
  });
});
