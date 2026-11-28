import { hexToBytes } from 'viem';
import { describe, expect, it } from 'vitest';
import { decodeCbor } from './cardano-cbor.js';

describe('CBOR witness-set mode', () => {
  it('rejects an unterminated container, a stray break, and an indefinite byte string', () => {
    for (const hex of ['0x9f00', '0xbf00ff', '0x5f4100ff'] as const) {
      expect(() => decodeCbor(hexToBytes(hex), true), hex).toThrow();
    }
  });
});
