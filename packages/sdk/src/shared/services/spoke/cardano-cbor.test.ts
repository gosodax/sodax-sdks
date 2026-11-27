import { hexToBytes } from 'viem';
import { describe, expect, it } from 'vitest';
import { decodeCbor } from './cardano-cbor.js';

describe('CBOR witness-set mode', () => {
  // One row per failure: an unterminated container, a stray break, and an indefinite byte string.
  it.each(['0x9f00', '0xbf00ff', '0x5f4100ff'] as const)('rejects malformed or unsupported witness input %s', hex => {
    expect(() => decodeCbor(hexToBytes(hex), true)).toThrow();
  });
});
