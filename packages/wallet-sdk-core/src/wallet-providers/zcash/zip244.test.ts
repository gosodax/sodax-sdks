import { describe, expect, it } from 'vitest';
import * as ecc from '@bitcoinerlab/secp256k1';
import { serializeZcashV5, zip244SignatureDigest, type Zip244Transaction } from './zip244.js';

/**
 * Ground truth rather than synthetic vectors: mainnet tx 3b12e264…364d, a 1-in / 2-out transparent v5 payout.
 * If the digest is right, the signature the network already accepted must verify against it — which exercises
 * the branch id and layout the live chain actually uses.
 */
const RAW =
  '050000800a27a7265b16a537000000000000000001553c9d9a1699dd2cc2e5625c68b9c105e75aa5e0f38731b8ce51ed4dea281d63010000006b4830450221008336997fe00ee797a1277c9ee6d9fd194447eb1159787545bf55b381a747f73e0220702dd01177e6d72bf53974b6426aa46b3e657ea04aac7bb22d9a7a3451fe2aeb0121028cd25f41a34d2b1c831ec7e6304207bb5018f5a428e7996979e0c46e74780703ffffffff02dc460f00000000001976a9148fce32d0d1961dc116556396b151aa5cdeed88ee88ac44910500000000001976a9144a8c4a21a1cd793ef4bc176fedf70d44f1a8b9ba88ac000000';
// The output this tx spends: tx 631d28ea…3c55, vout 1.
const PREV_VALUE = 1392848n;
const PREV_SCRIPT = '76a9144a8c4a21a1cd793ef4bc176fedf70d44f1a8b9ba88ac';

/** Parse the fixture's single input and outputs into the shape the serializer and digest take. */
function parseFixture(hex: string): { tx: Zip244Transaction; scriptSig: Buffer } {
  const b = Buffer.from(hex, 'hex');
  let o = 20; // header, version group, branch, lock time, expiry
  const consensusBranchId = b.readUInt32LE(8);
  const compact = (): number => b[o++] as number;
  expect(compact()).toBe(1);
  const txid = Buffer.from(b.subarray(o, o + 32))
    .reverse()
    .toString('hex');
  o += 32;
  const vout = b.readUInt32LE(o);
  o += 4;
  const sigLen = compact();
  const scriptSig = b.subarray(o, o + sigLen);
  o += sigLen + 4;
  const outputs = Array.from({ length: compact() }, () => {
    const value = b.readBigUInt64LE(o);
    o += 8;
    const len = compact();
    const scriptPubKey = b.subarray(o, o + len).toString('hex');
    o += len;
    return { value, scriptPubKey };
  });
  return {
    tx: {
      consensusBranchId,
      lockTime: b.readUInt32LE(12),
      expiryHeight: b.readUInt32LE(16),
      inputs: [{ txid, vout, value: PREV_VALUE, scriptPubKey: PREV_SCRIPT, scriptSig: scriptSig.toString('hex') }],
      outputs,
    },
    scriptSig,
  };
}

/** A DER signature as the 64-byte compact form, without its trailing hash-type byte. */
function derToCompact(der: Buffer): Buffer {
  let o = 2;
  const rLen = der[o + 1] as number;
  const r = der.subarray(o + 2, o + 2 + rLen);
  o += 2 + rLen;
  const s = der.subarray(o + 2, o + 2 + (der[o + 1] as number));
  const pad = (x: Buffer) =>
    Buffer.concat([Buffer.alloc(32), x.subarray(x.length > 32 ? x.length - 32 : 0)]).subarray(-32);
  return Buffer.concat([pad(r), pad(s)]);
}

describe('ZIP-244 against a network-accepted mainnet transaction', () => {
  const { tx, scriptSig } = parseFixture(RAW);

  it('re-serializes the transaction byte for byte', () => {
    expect(Buffer.from(serializeZcashV5(tx)).toString('hex')).toBe(RAW);
  });

  it('computes the digest the accepted signature verifies against', () => {
    const sigLen = scriptSig[0] as number;
    const derWithType = scriptSig.subarray(1, 1 + sigLen);
    const pubkey = scriptSig.subarray(2 + sigLen);
    const unsigned = { ...tx, inputs: tx.inputs.map(i => ({ ...i, scriptSig: '' })) };

    const digest = zip244SignatureDigest(unsigned, 0);

    expect(ecc.verify(digest, pubkey, derToCompact(derWithType.subarray(0, -1)))).toBe(true);
  });

  it('does not verify when an output changes, since SIGHASH_ALL commits to every output', () => {
    const sigLen = scriptSig[0] as number;
    const derWithType = scriptSig.subarray(1, 1 + sigLen);
    const pubkey = scriptSig.subarray(2 + sigLen);
    const [first, ...rest] = tx.outputs;
    if (!first) throw new Error('fixture has no outputs');
    const tampered = { ...tx, outputs: [{ ...first, value: 1n }, ...rest] };

    expect(ecc.verify(zip244SignatureDigest(tampered, 0), pubkey, derToCompact(derWithType.subarray(0, -1)))).toBe(
      false,
    );
  });
});
