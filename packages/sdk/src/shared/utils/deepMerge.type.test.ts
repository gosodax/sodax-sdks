/** Pins `deepMerge`: the result is the target's own type, inferred per call. */
import { describe, expectTypeOf, it } from 'vitest';
import { deepMerge } from './deepMerge.js';

type Flat = { a: number; b: string };
type Nested = { api: { baseURL: string; timeout: number }; flags: string[] };
declare const flat: Flat;
declare const nested: Nested;

describe('shared/utils/deepMerge', () => {
  it('returns the target type', () => {
    const merged = () => deepMerge(flat, { a: 1 });
    const mergedNested = () => deepMerge(nested, { api: { timeout: 5 } });
    expectTypeOf<ReturnType<typeof merged>>().toEqualTypeOf<Flat>();
    expectTypeOf<ReturnType<typeof mergedNested>>().toEqualTypeOf<Nested>();
    // @ts-expect-error — source field type must match the target's
    const invalid = () => deepMerge(flat, { a: 'one' });
    expectTypeOf(invalid).toBeFunction();
  });
});
