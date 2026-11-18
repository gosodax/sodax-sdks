/** Pins the Stacks helpers: transaction wait to boolean, principal serialization to `Hex`. */
import { describe, expectTypeOf, it } from 'vitest';
import type { Hex } from '../../index.js';
import type { serializeAddressData, waitForStacksTransaction } from './stacks-utils.js';

describe('shared/utils/stacks-utils', () => {
  it('pins each result', () => {
    expectTypeOf<ReturnType<typeof waitForStacksTransaction>>().toEqualTypeOf<Promise<boolean>>();
    expectTypeOf<ReturnType<typeof serializeAddressData>>().toEqualTypeOf<Hex>();
  });
});
