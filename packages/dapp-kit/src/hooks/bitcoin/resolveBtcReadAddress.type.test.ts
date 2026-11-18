/**
 * Compile-time contract: `resolveBtcReadAddress` maps any spoke chain and address to a read address.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { SpokeChainKey } from '@sodax/sdk';
import { resolveBtcReadAddress } from './resolveBtcReadAddress.js';

describe('resolveBtcReadAddress', () => {
  it('takes a spoke chain key and an address and returns a string', () => {
    expectTypeOf<Parameters<typeof resolveBtcReadAddress>>().toEqualTypeOf<
      [chainKey: SpokeChainKey, address: string]
    >();
    expectTypeOf<ReturnType<typeof resolveBtcReadAddress>>().toEqualTypeOf<string>();
  });

  it('rejects a chain key outside the spoke-chain union', () => {
    // @ts-expect-error — not a spoke chain key
    const unknownChain = () => resolveBtcReadAddress('not-a-chain', 'bc1q');
    expectTypeOf(unknownChain).toBeFunction();
  });
});
