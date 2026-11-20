/** Pins the result type of the normalized-to-USD conversion. */
import type BigNumber from 'bignumber.js';
import { describe, expectTypeOf, it } from 'vitest';
import type { normalizedToUsd } from './normalized-to-usd.js';

describe('normalizedToUsd', () => {
  it('returns a BigNumber', () => {
    expectTypeOf<ReturnType<typeof normalizedToUsd>>().toEqualTypeOf<BigNumber>();
  });
});
