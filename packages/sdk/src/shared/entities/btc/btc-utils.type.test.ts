/** Compile-time contract for `btc-utils.ts`: size estimates are numbers, encoders and normalizers return strings. */
import { describe, expectTypeOf, it } from 'vitest';
import type { BtcAddressType, BtcPayload } from '../../../index.js';
import {
  calcOpReturnOutputVbytes,
  canonicalizeBitcoinAddress,
  encodeBtcPayloadToBytes,
  estimateBitcoinTxSize,
  isValidBitcoinAddress,
  normalizePsbtToBase64,
  normalizeSignatureToBase64,
} from './btc-utils.js';

describe('btc-utils type contract', () => {
  it('size helpers return number', () => {
    expectTypeOf(calcOpReturnOutputVbytes).returns.toEqualTypeOf<number>();
    expectTypeOf(estimateBitcoinTxSize).returns.toEqualTypeOf<number>();
    expectTypeOf(estimateBitcoinTxSize).parameter(2).toEqualTypeOf<BtcAddressType | undefined>();
  });

  it('encoders and normalizers return string', () => {
    expectTypeOf(encodeBtcPayloadToBytes).parameter(0).toEqualTypeOf<BtcPayload>();
    expectTypeOf(encodeBtcPayloadToBytes).returns.toEqualTypeOf<string>();
    expectTypeOf(canonicalizeBitcoinAddress).returns.toEqualTypeOf<string>();
    expectTypeOf(normalizePsbtToBase64).returns.toEqualTypeOf<string>();
    expectTypeOf(normalizeSignatureToBase64).returns.toEqualTypeOf<string>();
  });

  it('isValidBitcoinAddress returns boolean', () => {
    expectTypeOf(isValidBitcoinAddress).returns.toEqualTypeOf<boolean>();
  });
});
