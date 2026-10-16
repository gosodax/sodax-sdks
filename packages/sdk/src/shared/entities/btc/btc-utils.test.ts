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

  it('≤75 byte payload uses direct push opcode (scriptSize = 3 + len, 1-byte varint)', () => {
    // scriptSize = 3+33=36, varint=1 → 8+1+36 = 45
    expect(calcOpReturnOutputVbytes(33)).toBe(45);
  });

  it('boundary: payload = 75 still uses direct push', () => {
    // scriptSize = 3+75=78, varint=1 → 8+1+78 = 87
    expect(calcOpReturnOutputVbytes(75)).toBe(87);
  });

  it('boundary: payload = 76 switches to OP_PUSHDATA1', () => {
    // scriptSize = 4+76=80, varint=1 → 8+1+80 = 89
    expect(calcOpReturnOutputVbytes(76)).toBe(89);
  });

  it('≤255 byte payload with scriptSize exactly 252 keeps 1-byte varint', () => {
    // payload=248: scriptSize = 4+248=252, varint=1 → 8+1+252 = 261
    expect(calcOpReturnOutputVbytes(248)).toBe(261);
  });

  it('≤255 byte payload with scriptSize 253 flips to 3-byte varint', () => {
    // payload=249: scriptSize = 4+249=253, varint=3 → 8+3+253 = 264
    expect(calcOpReturnOutputVbytes(249)).toBe(264);
  });

  it('>255 byte payload uses OP_PUSHDATA2 (scriptSize = 5 + len, 3-byte varint)', () => {
    // payload=256: scriptSize = 5+256=261, varint=3 → 8+3+261 = 272
    expect(calcOpReturnOutputVbytes(256)).toBe(272);
  });
});

describe('estimateBitcoinTxSize', () => {
  // Formula: Math.ceil(10.5 + opReturnVbytes + SAFETY(20) + inputs*inputWeight + outputs*31)
  // Default: opReturnVbytes=44, inputWeight=68 (P2WPKH)

  it('default P2WPKH — 1 input, 1 output', () => {
    // Math.ceil(10.5 + 44 + 20 + 68 + 31) = Math.ceil(173.5) = 174
    expect(estimateBitcoinTxSize(1, 1)).toBe(174);
  });

  it('P2PKH address type uses 148 vB per input', () => {
    // Math.ceil(10.5 + 44 + 20 + 148 + 31) = Math.ceil(253.5) = 254
    expect(estimateBitcoinTxSize(1, 1, 'P2PKH')).toBe(254);
  });

  it('P2SH address type uses 91 vB per input', () => {
    // Math.ceil(10.5 + 44 + 20 + 91 + 31) = Math.ceil(196.5) = 197
    expect(estimateBitcoinTxSize(1, 1, 'P2SH')).toBe(197);
  });

  it('P2TR address type uses 58 vB per input', () => {
    // Math.ceil(10.5 + 44 + 20 + 58 + 31) = Math.ceil(163.5) = 164
    expect(estimateBitcoinTxSize(1, 1, 'P2TR')).toBe(164);
  });

  it('scales linearly with input and output count', () => {
    // Math.ceil(10.5 + 44 + 20 + 3*68 + 2*31) = Math.ceil(340.5) = 341
    expect(estimateBitcoinTxSize(3, 2)).toBe(341);
  });

  it('custom opReturnOutputVbytes overrides the default 44', () => {
    // Math.ceil(10.5 + 45 + 20 + 68 + 31) = Math.ceil(174.5) = 175
    expect(estimateBitcoinTxSize(1, 1, undefined, 45)).toBe(175);
  });

  it('BITCOIN_FEE_SAFETY_VBYTES(20) is included — removing it would change the result', () => {
    // Baseline without safety would be Math.ceil(10.5 + 44 + 68 + 31) = Math.ceil(153.5) = 154.
    // With safety = 174, confirming the 20 vB constant is load-bearing.
    expect(estimateBitcoinTxSize(1, 1)).toBeGreaterThan(154);
    expect(estimateBitcoinTxSize(1, 1)).toBe(174);
  });
});

describe('normalizeSignatureToBase64', () => {
  // Browser wallets (UniSat/Xverse/OKX) already return base64 — the relay's required form — so a
  // base64 signature must pass through untouched. Real base64 carries chars outside the hex set
  // ('=' padding, '+'/'/', upper-case G–Z), which is exactly what marks it as "not hex".
  it('passes a base64 signature through unchanged', () => {
    expect(normalizeSignatureToBase64('EjQ=')).toBe('EjQ=');
    expect(normalizeSignatureToBase64('aGVsbG8=')).toBe('aGVsbG8='); // base64("hello"), has non-hex chars
  });

  // A private-key wallet may hand back a hex signature; it is encoded to base64 before relay submit.
  it('encodes a hex signature to base64', () => {
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
  it('preserves a case-sensitive P2PKH address exactly', () => {
    const json = encodeBtcPayloadToBytes({
      ...base,
      src_address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
      address_type: 'P2PKH',
    });
    expect(JSON.parse(json).src_address).toBe('1BoatSLRHtKNngkdXEeobR76b53LETtpyT');
  });

  it('preserves a case-sensitive P2SH address exactly', () => {
    const json = encodeBtcPayloadToBytes({
      ...base,
      src_address: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
      address_type: 'P2SH',
    });
    expect(JSON.parse(json).src_address).toBe('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy');
  });

  // Bech32 is case-insensitive with a lowercase canonical form — normalization stays.
  it('canonicalizes a bech32 address to lowercase', () => {
    const json = encodeBtcPayloadToBytes({
      ...base,
      src_address: 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4',
    });
    expect(JSON.parse(json).src_address).toBe('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  });

  it('lowercases hex data for every address type', () => {
    const p2pkh = encodeBtcPayloadToBytes({ ...base, address_type: 'P2PKH' });
    expect(JSON.parse(p2pkh).data).toBe('0xdeadbeef');
    expect(JSON.parse(encodeBtcPayloadToBytes(base)).data).toBe('0xdeadbeef');
  });

  // The wallet signs this exact string; key order is part of the signed bytes.
  it('keeps the signed key order stable', () => {
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
