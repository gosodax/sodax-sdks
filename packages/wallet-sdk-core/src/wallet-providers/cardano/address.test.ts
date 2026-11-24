import { describe, expect, it } from 'vitest';
import { cardanoAddressFromRawHex } from './address.js';

// Vectors from the MPC relay's shared contract/SDK vector file: the same key hash as an enterprise and a base address.
const ENTERPRISE = {
  hex: '618b218424ad74df25d35c2ea8e094a4c5c5aeb2cbb442419331569313',
  bech32: 'addr1vx9jrppy446d7fwntsh23cy55nzutt4jew6yysvnx9tfxychfqm3y',
};
const BASE = {
  hex: '018b218424ad74df25d35c2ea8e094a4c5c5aeb2cbb44241933156931344444444444444444444444444444444444444444444444444444444',
  bech32: 'addr1qx9jrppy446d7fwntsh23cy55nzutt4jew6yysvnx9tfxy6yg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zqqaz7tl',
};
const TESTNET_ENTERPRISE = '608b218424ad74df25d35c2ea8e094a4c5c5aeb2cbb442419331569313';
const SCRIPT_ENTERPRISE = '7155555555555555555555555555555555555555555555555555555555';
const REWARD = 'e18b218424ad74df25d35c2ea8e094a4c5c5aeb2cbb442419331569313';
const POINTER = '418b218424ad74df25d35c2ea8e094a4c5c5aeb2cbb442419331569313010203';

describe('cardanoAddressFromRawHex', () => {
  it('encodes an enterprise and a base mainnet address to their bech32 form', () => {
    expect(cardanoAddressFromRawHex(ENTERPRISE.hex)).toBe(ENTERPRISE.bech32);
    expect(cardanoAddressFromRawHex(BASE.hex)).toBe(BASE.bech32);
  });

  it('accepts the hex with a 0x prefix', () => {
    expect(cardanoAddressFromRawHex(`0x${ENTERPRISE.hex}`)).toBe(ENTERPRISE.bech32);
  });

  it.each([
    ['a testnet address', TESTNET_ENTERPRISE, /network id 0/],
    ['a script payment address', SCRIPT_ENTERPRISE, /header type 7 cannot sign data/],
    ['a reward address', REWARD, /header type 14 cannot sign data/],
    ['a pointer address', POINTER, /header type 4 cannot sign data/],
    ['an empty address', '', /empty address/],
    ['a base address cut short', BASE.hex.slice(0, 100), /must be 57 bytes/],
  ])('refuses %s', (_label, hex, message) => {
    expect(() => cardanoAddressFromRawHex(hex)).toThrow(message);
  });
});
