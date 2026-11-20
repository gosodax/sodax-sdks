/** Pins the result types of the ray/wad fixed-point helpers. */
import type BigNumber from 'bignumber.js';
import { describe, expectTypeOf, it } from 'vitest';
import type { binomialApproximatedRayPow, rayDiv, rayMul, rayPow, rayToWad, wadToRay } from './ray.math.js';

describe('ray math', () => {
  it('every helper returns a BigNumber', () => {
    expectTypeOf<ReturnType<typeof rayMul>>().toEqualTypeOf<BigNumber>();
    expectTypeOf<ReturnType<typeof rayDiv>>().toEqualTypeOf<BigNumber>();
    expectTypeOf<ReturnType<typeof rayToWad>>().toEqualTypeOf<BigNumber>();
    expectTypeOf<ReturnType<typeof wadToRay>>().toEqualTypeOf<BigNumber>();
    expectTypeOf<ReturnType<typeof rayPow>>().toEqualTypeOf<BigNumber>();
    expectTypeOf<ReturnType<typeof binomialApproximatedRayPow>>().toEqualTypeOf<BigNumber>();
  });
});
