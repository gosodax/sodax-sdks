import { hexToBytes } from 'viem';
import { describe, expect, it } from 'vitest';
import { decodeCbor } from './cardano-cbor.js';

describe('CBOR witness-set mode', () => {
  it.each(['0x9f00ff', '0xbf0001ff'] as const)('keeps COSE decoding strict for %s', hex => {
    expect(() => decodeCbor(hexToBytes(hex))).toThrow(/indefinite/);
  });

  it.each([
    '0xff',
    '0x9f00',
    '0xbf0001',
    '0xbf00ff',
    '0x81ff',
    '0x5f4100ff',
    '0x7f6161ff',
  ] as const)('rejects malformed or unsupported witness input %s', hex => {
    expect(() => decodeCbor(hexToBytes(hex), true)).toThrow();
  });
});
