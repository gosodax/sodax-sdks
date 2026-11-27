import { decodeAbiParameters, encodeAbiParameters, encodePacked } from 'viem';
import type { Hex } from '@sodax/types';
import { IntentDataType, type IntentData } from '../shared/types/intent-types.js';

/** Mirrors `IntentDataLib`'s `abi.decode(data, (ArrayData))`, `DataEntry = { uint8 dataType, bytes data }`. */
const ARRAY_DATA_ABI = [
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
] as const;

/** Packs/unpacks the typed entries of `Intent.data` (fee, delivery) as `IntentDataLib` decodes them. */
export class IntentDataService {
  private constructor() {}

  /** A single entry stays a bare packed envelope, so fee-only `data` is byte-identical to before delivery support. */
  public static composeIntentData(feeEnvelope: Hex, deliveryData?: Hex): Hex {
    const entries: IntentData[] = [];
    if (feeEnvelope !== '0x') {
      // Strip the leading type byte.
      entries.push({ type: IntentDataType.FEE, data: `0x${feeEnvelope.slice(4)}` });
    }
    if (deliveryData && deliveryData !== '0x') {
      entries.push({ type: IntentDataType.DELIVERY, data: deliveryData });
    }
    return IntentDataService.encodeIntentData(entries);
  }

  /** Empty → `'0x'`; single → packed `[uint8 type, bytes]`; multiple → `TYPE_ARRAY` wrapping `ArrayData`. */
  public static encodeIntentData(entries: IntentData[]): Hex {
    if (entries.length === 0) {
      return '0x';
    }
    const [first] = entries;
    if (first && entries.length === 1) {
      return encodePacked(['uint8', 'bytes'], [first.type, first.data]);
    }
    const encodedArray = encodeAbiParameters(ARRAY_DATA_ABI, [
      { data: entries.map(e => ({ dataType: e.type, data: e.data })) },
    ]);
    return encodePacked(['uint8', 'bytes'], [IntentDataType.ARRAY, encodedArray]);
  }

  /** Raw `FeeData` payload from any envelope shape; `undefined` when there is no fee (unknown type bytes are logged). */
  public static extractFeePayload(data: Hex): Hex | undefined {
    if (data === '0x' || data.length <= 2) {
      return undefined;
    }

    // encodePacked(['uint8', 'bytes'], …) prepends a single type byte (2 hex chars).
    const typeByte = Number.parseInt(data.slice(2, 4), 16);

    if (typeByte === IntentDataType.FEE) {
      return `0x${data.slice(4)}`;
    }

    if (typeByte === IntentDataType.ARRAY) {
      const [arrayData] = decodeAbiParameters(ARRAY_DATA_ABI, `0x${data.slice(4)}`);
      return arrayData.data.find(e => e.dataType === IntentDataType.FEE)?.data;
    }

    if (typeByte === IntentDataType.DELIVERY) {
      return undefined;
    }

    console.error(
      `[IntentDataService.extractFeePayload] Unknown IntentData type byte: ${typeByte}. Gracefully returning no fee.`,
    );
    return undefined;
  }
}
