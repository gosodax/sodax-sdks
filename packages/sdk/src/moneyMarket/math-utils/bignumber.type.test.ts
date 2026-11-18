/** Pins the result types of the BigNumber conversion helpers. */
import type BigNumber from 'bignumber.js';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BigNumberZeroDecimal,
  normalize,
  normalizeBN,
  valueToBigNumber,
  valueToZDBigNumber,
} from './bignumber.js';

describe('bignumber helpers', () => {
  it('valueToBigNumber and valueToZDBigNumber return a BigNumber', () => {
    expectTypeOf<ReturnType<typeof valueToBigNumber>>().toEqualTypeOf<BigNumber>();
    expectTypeOf<ReturnType<typeof valueToZDBigNumber>>().toEqualTypeOf<BigNumber>();
  });

  it('normalize returns a decimal string, normalizeBN a BigNumber', () => {
    expectTypeOf<ReturnType<typeof normalize>>().toEqualTypeOf<string>();
    expectTypeOf<ReturnType<typeof normalizeBN>>().toEqualTypeOf<BigNumber>();
  });

  it('BigNumberZeroDecimal is a BigNumber constructor', () => {
    expectTypeOf<InstanceType<typeof BigNumberZeroDecimal>>().toEqualTypeOf<BigNumber>();
    expectTypeOf<typeof BigNumberZeroDecimal>().toEqualTypeOf<typeof BigNumber>();
  });
});
