/**
 * Tests for the TON encoders. The expected values are pinned from the relay's own implementation
 * (`@mpcrelayer/common` and `@mpcrelayer/sdk`), because every one of these layouts is parsed or rebuilt
 * on the relay side and a drift fails there, often silently or terminally.
 */

import { describe, expect, it } from 'vitest';
import { Address, beginCell, Cell } from '@ton/core';
import { sha256 } from 'viem';
import { ChainKeys } from '@sodax/types';
import { encodeAddress, encodeRecipient, reverseEncodeAddress } from '../../utils/shared-utils.js';
import {
  buildJettonDepositBody,
  buildTonCommentBody,
  parseJettonNotificationMemo,
  parseTonComment,
  tonAddressHash,
  tonIdentityBytes,
  tonSignDataMessage,
  tonWalletAddress,
  tonWithdrawSignText,
} from './ton-utils.js';

const MEMO = `0x${'ab'.repeat(32)}`;
const PUBKEY_07 = `0x${'07'.repeat(32)}` as const;
const RESERVE = '0:2a7f65800a2ebe06fa227e7f29cd188d5c3e39d0566d8646c8c73104417a6a97';
const RESERVE_PUBKEY = 'fe9d58506e80230e2d2830e19114af2f9b1f02b372ccee866cbe066314426e79';

describe('tonWalletAddress', () => {
  it('matches the pinned wallet-v4R2 vector the NEAR contract is tested against', () => {
    expect(tonAddressHash(tonWalletAddress(PUBKEY_07))).toBe(
      '0x90d4b6f138065a04d8a8047eb892ccdb0b8d4cc298c0d2bfe28c88aa204f6195',
    );
  });

  it('derives the live mainnet reserve from its MPC public key', () => {
    expect(tonWalletAddress(RESERVE_PUBKEY).toRawString()).toBe(RESERVE);
  });
});

describe('tonIdentityBytes', () => {
  it('normalizes a public key to lowercase 0x hex', () => {
    expect(tonIdentityBytes('AB'.repeat(32))).toBe(`0x${'ab'.repeat(32)}`);
  });

  it('refuses anything that is not a 32-byte key, such as an address', () => {
    expect(() => tonIdentityBytes(RESERVE)).toThrow(/32-byte hex ed25519 public key/);
  });
});

describe('address encoding for TON', () => {
  it('uses the public key itself as the identity and decodes it back', () => {
    expect(encodeAddress(ChainKeys.TON_MAINNET, PUBKEY_07)).toBe(PUBKEY_07);
    expect(reverseEncodeAddress(ChainKeys.TON_MAINNET, PUBKEY_07)).toBe(PUBKEY_07);
  });

  it('pays a release to the 32-byte hash of the key wallet-v4R2 address, unpadded', () => {
    // Tron and XRP left-pad a 20-byte identity; a TON account hash already fills the word.
    expect(encodeRecipient(ChainKeys.TON_MAINNET, PUBKEY_07)).toBe(
      '0x90d4b6f138065a04d8a8047eb892ccdb0b8d4cc298c0d2bfe28c88aa204f6195',
    );
  });
});

describe('deposit bodies', () => {
  it('builds the native comment body byte-identical to the relay', () => {
    expect(buildTonCommentBody(MEMO).toBoc().toString('base64')).toBe(
      'te6cckEBAQEAJgAASAAAAACrq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq5fkBg8=',
    );
  });

  it('refuses a memo that is not 32 bytes', () => {
    expect(() => buildTonCommentBody('0xabcd')).toThrow(/must be 32 bytes/);
  });

  it('builds the jetton transfer byte-identical to the relay, forwarding enough TON to notify the reserve', () => {
    const body = buildJettonDepositBody({
      reserve: RESERVE,
      amount: 2_000_000n,
      payloadHash: MEMO,
      responseAddress: tonWalletAddress(PUBKEY_07).toString({ bounceable: false }),
      forwardTon: 100_000_000n,
    });

    expect(body.toBoc().toString('base64')).toBe(
      'te6cckEBAgEAgAABrg+KfqUAAAAAAAAAADHoSAgAVP7LABRdfA30RPz+U5oxGrh8c6Cs2wyNkY5iCIL01S8AJDUtvE4BloE2KgEfriSzNsLjUzCmMDSv+KMiKogT2GVIC+vCAQEASAAAAACrq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq0U74VE=',
    );
  });

  it('reads the memo back from a comment and from a jetton transfer_notification', () => {
    expect(parseTonComment(buildTonCommentBody(MEMO))).toBe(MEMO);

    const notification = beginCell()
      .storeUint(0x7362d09c, 32)
      .storeUint(0n, 64)
      .storeCoins(2_000_000n)
      .storeAddress(Address.parse(RESERVE))
      .storeBit(1)
      .storeRef(buildTonCommentBody(MEMO))
      .endCell();
    expect(parseJettonNotificationMemo(notification)).toBe(MEMO);
  });

  it('does not read a memo from an unrelated body', () => {
    const text = beginCell().storeUint(0, 32).storeStringTail('hello').endCell();
    expect(parseTonComment(text)).toBeNull();
    expect(parseJettonNotificationMemo(Cell.EMPTY)).toBeNull();
  });
});

describe('withdraw signing', () => {
  it('embeds the lowercase message hash in the text line the contract rebuilds', () => {
    expect(tonWithdrawSignText(`0x${'AB'.repeat(32)}`)).toBe(`SODAX withdrawal\nmessage: 0x${'ab'.repeat(32)}`);
  });

  it('lays out the signData message so its sha256 matches the relay digest', () => {
    const message = tonSignDataMessage({
      workchain: 0,
      addressHash: new Uint8Array(32).fill(0x11),
      domain: 'app.sodax.com',
      timestamp: 1789300000,
      payload: new TextEncoder().encode(tonWithdrawSignText(MEMO)),
      payloadType: 'txt',
    });

    expect(sha256(message)).toBe('0x872427e82265db051c9a7843dd706325ad1bd7a3c401448a378c9b46bb99772d');
  });
});
