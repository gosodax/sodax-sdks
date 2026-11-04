import { describe, expect, it, vi } from 'vitest';
import { Address } from '@ton/core';
import { keyPairFromSeed, signVerify } from '@ton/crypto';
import { WalletContractV4 } from '@ton/ton';
import { sha256 } from 'viem';
import { TonWalletProvider, tonSignDataMessage } from './TonWalletProvider.js';
import type { TonConnectLike } from './types.js';

const SEED = '42'.repeat(32);
const HASH = `0x${'ab'.repeat(32)}` as const;
const keyPair = keyPairFromSeed(Buffer.from(SEED, 'hex'));
const v4r2 = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey }).address;

const rawKey = (signDataDomain?: string) =>
  new TonWalletProvider({ privateKey: `0x${SEED}`, ...(signDataDomain ? { signDataDomain } : {}) });

describe('tonSignDataMessage', () => {
  it('lays out the signData message so its sha256 matches the relay digest', () => {
    // Pinned from the relay's `buildTonSignDataDigest` for the same inputs.
    const message = tonSignDataMessage({
      workchain: 0,
      addressHash: new Uint8Array(32).fill(0x11),
      domain: 'app.sodax.com',
      timestamp: 1789300000,
      text: `SODAX withdrawal\nmessage: ${HASH}`,
    });

    expect(sha256(message)).toBe('0x872427e82265db051c9a7843dd706325ad1bd7a3c401448a378c9b46bb99772d');
  });
});

describe('TonWalletProvider — private key', () => {
  it('uses the 32-byte public key as its wallet address, since that is the relay identity', async () => {
    expect(await rawKey().getWalletAddress()).toBe(`0x${keyPair.publicKey.toString('hex')}`);
  });

  it('sends from the key wallet-v4R2 address', async () => {
    expect(await rawKey().getAccountAddress()).toBe(v4r2.toString({ bounceable: false }));
  });

  it('refuses a key that is not a 32-byte seed', () => {
    expect(() => new TonWalletProvider({ privateKey: '0x1234' })).toThrow(/32-byte hex seed/);
  });

  it('signs the withdraw text under a TonConnect envelope that verifies against its public key', async () => {
    const signed = await rawKey('app.sodax.com').signMessage(HASH);

    expect(signed).toMatchObject({
      workchain: 0,
      addressHash: `0x${Buffer.from(v4r2.hash).toString('hex')}`,
      domain: 'app.sodax.com',
      payloadType: 'txt',
    });
    // Rebuild the digest exactly as the relay does for scheme 5 and verify the signature.
    const digest = sha256(
      tonSignDataMessage({
        workchain: signed.workchain,
        addressHash: Buffer.from(signed.addressHash.slice(2), 'hex'),
        domain: signed.domain,
        timestamp: signed.timestamp,
        text: `SODAX withdrawal\nmessage: ${HASH}`,
      }),
      'bytes',
    );
    expect(signVerify(Buffer.from(digest), Buffer.from(signed.signature.slice(2), 'hex'), keyPair.publicKey)).toBe(
      true,
    );
  });

  it('binds the default domain when none is configured', async () => {
    expect((await rawKey().signMessage(HASH)).domain).toBe('sodax.com');
  });
});

describe('TonWalletProvider — TonConnect', () => {
  const RAW_ADDRESS = `0:${'33'.repeat(32)}`;
  const tonConnect = (over: Partial<TonConnectLike> = {}): TonConnectLike => ({
    account: { address: RAW_ADDRESS, publicKey: 'CD'.repeat(32) },
    sendTransaction: vi.fn(async () => ({ boc: 'x' })),
    signData: vi.fn(async () => ({
      signature: Buffer.from('ef'.repeat(64), 'hex').toString('base64'),
      address: RAW_ADDRESS,
      timestamp: 1789300000,
      domain: 'app.sodax.com',
    })),
    ...over,
  });

  it('reports the connected public key as its wallet address and the connected account as its sender', async () => {
    const provider = new TonWalletProvider({ tonConnect: tonConnect() });

    expect(await provider.getWalletAddress()).toBe(`0x${'cd'.repeat(32)}`);
    expect(await provider.getAccountAddress()).toBe(Address.parseRaw(RAW_ADDRESS).toString({ bounceable: false }));
  });

  it('refuses a wallet that does not expose its public key', async () => {
    const provider = new TonWalletProvider({ tonConnect: tonConnect({ account: { address: RAW_ADDRESS } }) });

    await expect(provider.getWalletAddress()).rejects.toThrow(/did not expose its public key/);
  });

  it('asks the wallet to signData the withdraw text, and maps its envelope for the relay', async () => {
    const tc = tonConnect();
    const signed = await new TonWalletProvider({ tonConnect: tc }).signMessage(HASH);

    expect(tc.signData).toHaveBeenCalledWith({ type: 'text', text: `SODAX withdrawal\nmessage: ${HASH}` });
    expect(signed).toEqual({
      signature: `0x${'ef'.repeat(64)}`,
      workchain: 0,
      addressHash: `0x${'33'.repeat(32)}`,
      domain: 'app.sodax.com',
      timestamp: 1789300000,
      payloadType: 'txt',
    });
  });

  it('hands the transaction to the wallet to send', async () => {
    const tc = tonConnect();
    const tx = { validUntil: 1, messages: [{ address: 'EQ', amount: '1', payload: 'x' }] };

    await new TonWalletProvider({ tonConnect: tc }).sendTransaction(tx);

    expect(tc.sendTransaction).toHaveBeenCalledWith(tx);
  });
});
