/**
 * Tests for IntentDataService — the `Intent.data` envelope layer for solver intents.
 *
 * Covers the public statics:
 *   - `composeIntentData` — folds the partner-fee envelope + optional delivery payload into one
 *     packed/array envelope (fee-only stays byte-identical to the bare fee envelope).
 *   - `encodeIntentData` — exercised through `composeIntentData`.
 *   - `extractFeePayload` — recovers the fee payload back out of whichever envelope shape `data` uses.
 *
 * Delivery payloads are built with `HookService.encodeDeliveryData` and fee envelopes with
 * `EvmSolverService.createIntentFeeData`, so the fixtures match what the intent constructors produce.
 */
import { describe, expect, it, vi } from 'vitest';
import { HookKind, type Hex } from '@sodax/types';
import { decodeAbiParameters, encodePacked } from 'viem';
import { IntentDataService } from './IntentDataService.js';
import { HookService } from './HookService.js';
import { EvmSolverService } from './EvmSolverService.js';
import { IntentDataType } from '../shared/types/intent-types.js';

const FEE_RECEIVER = '0xfee0fee0fee0fee0fee0fee0fee0fee0fee0fee0' as const;

const HC_RECIPIENT = '0x00000000000000000000000000000000000000Ad' as const;

describe('IntentDataService.composeIntentData', () => {
  // Arbitrary delivery payload, built via the common hook encoder.
  const hcDelivery = (recipient: string = HC_RECIPIENT): Hex =>
    HookService.encodeDeliveryData({ kind: HookKind.HYPERCORE_DEPOSIT }, recipient);

  it('returns "0x" with neither fee nor delivery, and the bare fee envelope byte-identically for fee-only (backward compat)', () => {
    expect(IntentDataService.composeIntentData('0x', undefined)).toBe('0x');
    expect(IntentDataService.composeIntentData('0x', '0x')).toBe('0x');
    const [feeEnvelope] = EvmSolverService.createIntentFeeData({ address: FEE_RECEIVER, amount: 5_000n }, 1_000_000n);
    expect(IntentDataService.composeIntentData(feeEnvelope, undefined)).toBe(feeEnvelope);
  });

  it('delivery-only emits a single TYPE_DELIVERY envelope', () => {
    const delivery = hcDelivery();
    expect(IntentDataService.composeIntentData('0x', delivery)).toBe(
      encodePacked(['uint8', 'bytes'], [IntentDataType.DELIVERY, delivery]),
    );
  });

  it('fee + delivery emits a TYPE_ARRAY envelope with both entries', () => {
    const [feeEnvelope] = EvmSolverService.createIntentFeeData({ address: FEE_RECEIVER, amount: 5_000n }, 1_000_000n);
    const delivery = hcDelivery();
    const data = IntentDataService.composeIntentData(feeEnvelope, delivery);

    expect(data.slice(0, 4)).toBe(`0x0${IntentDataType.ARRAY}`); // 0x00 type byte

    const [arrayData] = decodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            {
              name: 'data',
              type: 'tuple[]',
              components: [
                { name: 'dataType', type: 'uint8' },
                { name: 'data', type: 'bytes' },
              ],
            },
          ],
        },
      ],
      `0x${data.slice(4)}`,
    );
    const entries = arrayData.data as readonly { dataType: number; data: Hex }[];
    expect(entries.map(e => e.dataType)).toEqual([IntentDataType.FEE, IntentDataType.DELIVERY]);
    expect(entries[1]?.data).toBe(delivery);
  });
});

describe('IntentDataService.extractFeePayload', () => {
  it('returns undefined without logging for empty data and for a delivery-only envelope', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = IntentDataService.composeIntentData('0x', hcDeliveryFixture());
    expect(IntentDataService.extractFeePayload('0x')).toBeUndefined();
    expect(IntentDataService.extractFeePayload(data)).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('recovers the fee payload from a fee + delivery TYPE_ARRAY envelope', () => {
    const [feeEnvelope] = EvmSolverService.createIntentFeeData({ address: FEE_RECEIVER, amount: 1_234n }, 1_000_000n);
    const data = IntentDataService.composeIntentData(feeEnvelope, hcDeliveryFixture());
    // The extracted payload is the bare fee envelope's payload (envelope minus the leading type byte).
    expect(IntentDataService.extractFeePayload(data)).toBe(`0x${feeEnvelope.slice(4)}`);
  });

  it('logs and returns undefined for an unknown type byte', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bogus = encodePacked(['uint8', 'bytes'], [99, '0xdeadbeef']);
    expect(IntentDataService.extractFeePayload(bogus)).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown IntentData type byte'));
  });
});

function hcDeliveryFixture(): Hex {
  return HookService.encodeDeliveryData({ kind: HookKind.HYPERCORE_DEPOSIT }, HC_RECIPIENT);
}
