/** Pins the shared helpers: address / token encoding, fee math, `retry` (generic over the action's result). */
import { describe, expectTypeOf, it } from 'vitest';
import type { Hex, XToken } from '../../index.js';
import {
  type BigIntToHex,
  type adjustAmountByFee,
  type calculateFeeAmount,
  type calculatePercentageFeeAmount,
  encodeAddress,
  type encodeTokenIdentifier,
  type getRandomBytes,
  type hexToBigInt,
  type isNativeBitcoinTransfer,
  type parseToStroops,
  type randomUint256,
  retry,
  type reverseEncodeAddress,
  type sleep,
} from './shared-utils.js';

declare const tokenAction: () => Promise<XToken>;
declare const hashAction: (attempt: number) => Promise<Hex>;

describe('shared/utils/shared-utils', () => {
  it('retry resolves to the action result type', () => {
    const token = () => retry(tokenAction);
    const hash = () => retry(hashAction, 3, 10);
    expectTypeOf<ReturnType<typeof token>>().toEqualTypeOf<Promise<XToken>>();
    expectTypeOf<ReturnType<typeof hash>>().toEqualTypeOf<Promise<Hex>>();
    // @ts-expect-error — the action must return a promise
    const sync = () => retry(() => 1);
    expectTypeOf(sync).toBeFunction();
  });

  it('pins each non-narrowing result', () => {
    expectTypeOf<ReturnType<typeof isNativeBitcoinTransfer>>().toEqualTypeOf<boolean>();
    expectTypeOf<ReturnType<typeof getRandomBytes>>().toEqualTypeOf<Uint8Array>();
    expectTypeOf<ReturnType<typeof randomUint256>>().toEqualTypeOf<bigint>();
    expectTypeOf<ReturnType<typeof calculatePercentageFeeAmount>>().toEqualTypeOf<bigint>();
    expectTypeOf<ReturnType<typeof calculateFeeAmount>>().toEqualTypeOf<bigint>();
    expectTypeOf<ReturnType<typeof adjustAmountByFee>>().toEqualTypeOf<bigint>();
    expectTypeOf<ReturnType<typeof BigIntToHex>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<typeof encodeAddress>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<typeof encodeTokenIdentifier>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<typeof reverseEncodeAddress>>().toEqualTypeOf<string>();
    expectTypeOf<ReturnType<typeof hexToBigInt>>().toEqualTypeOf<bigint>();
    expectTypeOf<ReturnType<typeof parseToStroops>>().toEqualTypeOf<bigint>();
    expectTypeOf<ReturnType<typeof sleep>>().toEqualTypeOf<Promise<void>>();
  });

  it('encodeAddress rejects an unknown chain key', () => {
    // @ts-expect-error — not a SpokeChainKey
    const invalid = () => encodeAddress('not-a-chain', '0x0');
    expectTypeOf(invalid).toBeFunction();
  });
});
