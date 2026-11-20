/** Pins `estimateStepCost` to a bigint step count. */
import { describe, expectTypeOf, it } from 'vitest';
import type { estimateStepCost } from './icon-utils.js';

describe('shared/utils/icon-utils', () => {
  it('estimateStepCost resolves to bigint', () => {
    expectTypeOf<ReturnType<typeof estimateStepCost>>().toEqualTypeOf<Promise<bigint>>();
  });
});
