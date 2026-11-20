/** Compile-time contract for `icon/utils.ts`: an ICON address encodes to hex bytes. */
import { describe, expectTypeOf, it } from 'vitest';
import type { Hex } from '../../../index.js';
import { getIconAddressBytes } from './utils.js';

describe('icon utils type contract', () => {
  it('getIconAddressBytes returns Hex', () => {
    expectTypeOf(getIconAddressBytes).returns.toEqualTypeOf<Hex>();
  });
});
