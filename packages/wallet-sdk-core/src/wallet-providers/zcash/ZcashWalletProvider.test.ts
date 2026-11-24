import { describe, expect, it, vi } from 'vitest';
import * as ecc from '@bitcoinerlab/secp256k1';
import { ripemd160, sha256 } from 'viem';
import type { ZcashUnsignedTransaction } from '@sodax/types';
import { ZcashWalletProvider, zcashSignedMessageDigest } from './ZcashWalletProvider.js';
import { zip244SignatureDigest } from './zip244.js';
import type { ZcashWalletLike } from './types.js';

const PK = '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';
const HASH = `0x${'ab'.repeat(32)}` as const;
const provider = () => new ZcashWalletProvider({ privateKey: `0x${PK}` });
const publicKey = Buffer.from(ecc.pointFromScalar(Buffer.from(PK, 'hex'), true) as Uint8Array);
const hash160 = Buffer.from(ripemd160(sha256(publicKey, 'bytes'), 'bytes'));

/** A DER signature as its 64-byte compact `r ‖ s` form. */
function derToCompact(der: Buffer): Buffer {
  const rLength = der[3] as number;
  const r = der.subarray(4, 4 + rLength);
  const s = der.subarray(6 + rLength, 6 + rLength + (der[5 + rLength] as number));
  const word = (x: Buffer): Buffer => Buffer.concat([Buffer.alloc(32), x]).subarray(-32);
  return Buffer.concat([word(r), word(s)]);
}

describe('ZcashWalletProvider — address', () => {
  it('derives the mainnet t1 address from hash160 of the compressed public key', async () => {
    // Private key 1 (the generator point); pinned from the relay's own Zcash address derivation.
    const one = new ZcashWalletProvider({ privateKey: `0x${'00'.repeat(31)}01` });

    expect(await one.getWalletAddress()).toBe('t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs');
  });

  it('refuses a key that is not 32 bytes of hex', () => {
    expect(() => new ZcashWalletProvider({ privateKey: '0x1234' })).toThrow(/32 bytes of hex/);
  });
});

describe('ZcashWalletProvider.signMessage — scheme 6', () => {
  it('matches the relay signZcashMessage signature byte for byte', async () => {
    // Pinned from the relay's own `signZcashMessage` for this key and hash.
    expect(await provider().signMessage(HASH)).toBe(
      '0x20763e7dd9a699276e9403e3640b6329213b41438f1c7b2bf1e35ef7eef440accb2f0a9cb4099649802bb5ee6cdbe923aae3d1dd8ea8a2b794407f3335f1809f3d',
    );
  });

  it('recovers to the account identity, as the contract checks it', async () => {
    const signature = Buffer.from((await provider().signMessage(HASH)).slice(2), 'hex');
    const header = signature[0] as number;

    // 31 + recid: 27, plus 4 marking a compressed key.
    expect([31, 32]).toContain(header);
    const recovered = ecc.recover(zcashSignedMessageDigest(HASH), signature.subarray(1), (header - 31) as 0 | 1, true);
    expect(recovered && Buffer.from(ripemd160(sha256(recovered, 'bytes'), 'bytes'))).toEqual(hash160);
  });
});

describe('ZcashWalletProvider.signTransaction', () => {
  const p2pkh = `76a914${hash160.toString('hex')}88ac`;
  const tx: ZcashUnsignedTransaction = {
    consensusBranchId: 0x37a5165b,
    lockTime: 0,
    expiryHeight: 0,
    inputs: [
      { txid: 'aa'.repeat(32), vout: 1, value: 50_000n, scriptPubKey: p2pkh },
      { txid: 'bb'.repeat(32), vout: 0, value: 70_000n, scriptPubKey: p2pkh },
    ],
    outputs: [
      { value: 100_000n, scriptPubKey: `76a914${'22'.repeat(20)}88ac` },
      { value: 5_000n, scriptPubKey: p2pkh },
    ],
  };

  it('signs every input against its own ZIP-244 digest with the account key', async () => {
    const { signTransaction } = provider();
    if (!signTransaction) throw new Error('a raw-key provider signs transactions');
    const raw = Buffer.from(await signTransaction(tx), 'hex');

    // Walk the serialized inputs and verify each scriptSig signature.
    let o = 20;
    expect(raw[o++]).toBe(2);
    for (let i = 0; i < 2; i++) {
      o += 36;
      const scriptLength = raw[o++] as number;
      const script = raw.subarray(o, o + scriptLength);
      o += scriptLength + 4;
      const sigLength = script[0] as number;
      const der = script.subarray(1, sigLength); // without the trailing SIGHASH_ALL byte
      expect(script[sigLength]).toBe(0x01);
      expect(script.subarray(2 + sigLength)).toEqual(publicKey);
      expect(ecc.verify(zip244SignatureDigest(tx, i), publicKey, derToCompact(der))).toBe(true);
    }
  });
});

describe('ZcashWalletProvider — browser wallet', () => {
  it('delegates the address, the payment and message signing to the wallet', async () => {
    const wallet: ZcashWalletLike = {
      getAddress: vi.fn(async () => 't1address'),
      sendTransfer: vi.fn(async () => 'txid'),
      signMessage: vi.fn(async () => `0x${'11'.repeat(65)}` as const),
    };
    const p = new ZcashWalletProvider({ wallet });

    expect(await p.getWalletAddress()).toBe('t1address');
    expect(await p.sendTransfer?.({ to: 't1deposit', amount: 5n })).toBe('txid');
    expect(wallet.sendTransfer).toHaveBeenCalledWith({ to: 't1deposit', amount: 5n });
    await p.signMessage(`0x${'AB'.repeat(32)}`);
    // The wallet signs the lowercase hex TEXT of the hash, as `zcash-cli signmessage` would.
    expect(wallet.signMessage).toHaveBeenCalledWith(`0x${'ab'.repeat(32)}`);
  });

  it('offers exactly one way to pay per mode, so the sdk picks the right deposit flow', () => {
    const wallet: ZcashWalletLike = {
      getAddress: vi.fn(),
      sendTransfer: vi.fn(),
      signMessage: vi.fn(),
    };

    expect(new ZcashWalletProvider({ wallet }).signTransaction).toBeUndefined();
    expect(provider().sendTransfer).toBeUndefined();
    expect(provider().signTransaction).toBeTypeOf('function');
  });
});
