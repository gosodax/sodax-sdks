/** Pins the sponsored-create builder, its fee / timebound derivations and its void validators. */
import type { Transaction } from '@stellar/stellar-sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  assertSignedByAccount,
  assertSponsoredCreateInputs,
  assertValidStellarAccountId,
  buildSponsoredCreate,
  deriveSponsorBaseFee,
  resolveTimeboundSeconds,
} from './stellarSponsoredCreate.js';

describe('sponsoring/internal/stellarSponsoredCreate', () => {
  it('pins each result', () => {
    expectTypeOf<ReturnType<typeof deriveSponsorBaseFee>>().toEqualTypeOf<{ baseFee: string; totalFee: bigint }>();
    expectTypeOf<ReturnType<typeof resolveTimeboundSeconds>>().toEqualTypeOf<number>();
    expectTypeOf<ReturnType<typeof buildSponsoredCreate>>().toEqualTypeOf<Transaction>();
    expectTypeOf<ReturnType<typeof assertSponsoredCreateInputs>>().toBeVoid();
    expectTypeOf<ReturnType<typeof assertValidStellarAccountId>>().toBeVoid();
    expectTypeOf<ReturnType<typeof assertSignedByAccount>>().toBeVoid();
  });
});
