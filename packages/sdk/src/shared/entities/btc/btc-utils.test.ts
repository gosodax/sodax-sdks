import { describe, expect, it } from 'vitest';
import {
  type BtcPayload,
  calcOpReturnOutputVbytes,
  encodeBtcPayloadToBytes,
  estimateBitcoinTxSize,
  normalizeSignatureToBase64,
} from './btc-utils.js';

describe('calcOpReturnOutputVbytes', () => {
  // Formula: script = OP_RETURN(1) + OP_12(1) + pushdata_overhead + payload
  // ≤75 bytes: overhead=1 (direct opcode), scriptSize = 3 + len
  // ≤255 bytes: overhead=2 (OP_PUSHDATA1 + 1-byte len), scriptSize = 4 + len
  // >255 bytes: overhead=3 (OP_PUSHDATA2 + 2-byte len), scriptSize = 5 + len
  // varint: scriptSize ≤ 252 → 1 byte; > 252 → 3 bytes
  // total = 8 (output value) + scriptLenVarint + scriptSize

  it('sizes the output across the push-opcode and varint boundaries', () => {
    const rows: Array<[label: string, payload: number, vbytes: number]> = [
      // Direct push → OP_PUSHDATA1 between a 75- and a 76-byte payload.
      ['75: scriptSize = 3+75=78, varint=1 → 8+1+78', 75, 87],
      ['76: scriptSize = 4+76=80, varint=1 → 8+1+80', 76, 89],
      // The varint flips to 3 bytes once scriptSize passes 252.
      ['248: scriptSize = 4+248=252, varint=1 → 8+1+252', 248, 261],
      ['249: scriptSize = 4+249=253, varint=3 → 8+3+253', 249, 264],
      // >255 bytes uses OP_PUSHDATA2.
      ['256: scriptSize = 5+256=261, varint=3 → 8+3+261', 256, 272],
    ];
    for (const [label, payload, vbytes] of rows) expect(calcOpReturnOutputVbytes(payload), label).toBe(vbytes);
  });
});

describe('estimateBitcoinTxSize', () => {
  // Formula: Math.ceil(10.5 + opReturnVbytes + SAFETY(20) + inputs*inputWeight + outputs*31)
  // Default: opReturnVbytes=44, inputWeight=68 (P2WPKH)

  it('weighs each input by address type, defaulting to P2WPKH', () => {
    // Math.ceil(10.5 + 44 + 20 + 68 + 31) = 174; without the 20 vB safety margin it would be 154.
    expect(estimateBitcoinTxSize(1, 1)).toBe(174);
    // Math.ceil(10.5 + 44 + 20 + 148 + 31) = 254
    expect(estimateBitcoinTxSize(1, 1, 'P2PKH')).toBe(254);
    // Math.ceil(10.5 + 44 + 20 + 91 + 31) = 197
    expect(estimateBitcoinTxSize(1, 1, 'P2SH')).toBe(197);
    // Math.ceil(10.5 + 44 + 20 + 58 + 31) = 164
    expect(estimateBitcoinTxSize(1, 1, 'P2TR')).toBe(164);
  });
});

describe('normalizeSignatureToBase64', () => {
  // Browser wallets (UniSat/Xverse/OKX) already return base64 — the relay's required form — so a
  // base64 signature must pass through untouched. Real base64 carries chars outside the hex set
  // ('=' padding, '+'/'/', upper-case G–Z), which is exactly what marks it as "not hex".
  // A private-key wallet may hand back a hex signature; it is encoded to base64 before relay submit.
  it('passes a base64 signature through unchanged and encodes a hex one to base64', () => {
    expect(normalizeSignatureToBase64('EjQ=')).toBe('EjQ=');
    expect(normalizeSignatureToBase64('aGVsbG8=')).toBe('aGVsbG8='); // base64("hello"), has non-hex chars
    expect(normalizeSignatureToBase64('deadbeef')).toBe('3q2+7w==');
  });
});

describe('encodeBtcPayloadToBytes', () => {
  const base: BtcPayload = {
    src_address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    data: '0xDEADBEEF',
    src_chain_id: 1,
    dst_chain_id: 2,
    wallet_used: 'USER',
    timestamp: 1756280000000,
    address_type: 'P2WPKH',
  };

  // Base58Check is case-sensitive: lowercasing a P2PKH/P2SH address breaks its checksum and
  // no longer names the signer's address, so the relay-side verifier rejects the payload.
  it('preserves a case-sensitive P2PKH or P2SH address exactly', () => {
    const p2pkh = encodeBtcPayloadToBytes({
      ...base,
      src_address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
      address_type: 'P2PKH',
    });
    const p2sh = encodeBtcPayloadToBytes({
      ...base,
      src_address: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
      address_type: 'P2SH',
    });
    expect(JSON.parse(p2pkh).src_address).toBe('1BoatSLRHtKNngkdXEeobR76b53LETtpyT');
    expect(JSON.parse(p2sh).src_address).toBe('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy');
  });

  // Bech32 is case-insensitive with a lowercase canonical form — normalization stays.
  it('canonicalizes a bech32 address to lowercase', () => {
    const json = encodeBtcPayloadToBytes({
      ...base,
      src_address: 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4',
    });
    expect(JSON.parse(json).src_address).toBe('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  });

  // The wallet signs this exact string; key order is part of the signed bytes.
  it('lowercases hex data for every address type and keeps the signed key order stable', () => {
    const p2pkh = encodeBtcPayloadToBytes({ ...base, address_type: 'P2PKH' });
    expect(JSON.parse(p2pkh).data).toBe('0xdeadbeef');
    expect(JSON.parse(encodeBtcPayloadToBytes(base)).data).toBe('0xdeadbeef');
    expect(Object.keys(JSON.parse(encodeBtcPayloadToBytes(base)))).toEqual([
      'src_address',
      'data',
      'src_chain_id',
      'dst_chain_id',
      'wallet_used',
      'timestamp',
      'address_type',
    ]);
  });
});
