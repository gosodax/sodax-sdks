/** Pins `useLeveragePositionPayoutAddress`: a synchronous hub-or-owner pick, `Address | undefined`. */
import type { Address, SpokeChainKey } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { useLeveragePositionPayoutAddress } from './useLeveragePositionPayoutAddress.js';

describe('useLeveragePositionPayoutAddress', () => {
  it('accepts optional params', () => {
    expectTypeOf<Parameters<typeof useLeveragePositionPayoutAddress>[0]>().toEqualTypeOf<
      | {
          params?: {
            chainKey: SpokeChainKey;
            signerAddress: Address | undefined;
            owner: Address | undefined;
          };
        }
      | undefined
    >();
  });

  it('returns the payout address', () => {
    expectTypeOf<ReturnType<typeof useLeveragePositionPayoutAddress>>().toEqualTypeOf<Address | undefined>();
  });
});
