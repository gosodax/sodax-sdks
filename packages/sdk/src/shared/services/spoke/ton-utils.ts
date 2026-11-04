/**
 * TON encoding helpers for the MPC relay. Every byte layout here is parsed or rebuilt by the relay
 * (verifier, NEAR contract) and must match it exactly: a wrong comment cell is silently skipped by the
 * verifier, a wrong jetton body bounces the jettons back, and a wrong address sends a release to an
 * account nobody expects. Ported from the relay's own `@mpcrelayer/common` TON module.
 */
import { Address, beginCell, Cell, contractAddress } from '@ton/core';
import type { Hex } from 'viem';

/** TEP-74 jetton `transfer` op code. */
export const JETTON_TRANSFER_OP = 0x0f8a7ea5;

/** TEP-74 jetton `transfer_notification` op code — what the reserve receives for a jetton deposit. */
export const JETTON_TRANSFER_NOTIFICATION_OP = 0x7362d09c;

/** wallet-v4R2's default subwallet id for workchain 0 (matches the NEAR bridge and `WalletContractV4`). */
const TON_SUBWALLET_ID = 698983191;

/** wallet-v4R2 code cell (base64 BoC). Only its representation hash enters the account id. */
const WALLET_V4R2_CODE_BOC =
  'te6cckECFAEAAtQAART/APSkE/S88sgLAQIBIAIPAgFIAwYC5tAB0NMDIXGwkl8E4CLXScEgkl8E4ALTHyGCEHBsdWe9IoIQZHN0cr2wkl8F4AP6QDAg+kQByMoHy//J0O1E0IEBQNch9AQwXIEBCPQKb6Exs5JfB+AF0z/IJYIQcGx1Z7qSODDjDQOCEGRzdHK6kl8G4w0EBQB4AfoA9AQw+CdvIjBQCqEhvvLgUIIQcGx1Z4MesXCAGFAEywUmzxZY+gIZ9ADLaRfLH1Jgyz8gyYBA+wAGAIpQBIEBCPRZMO1E0IEBQNcgyAHPFvQAye1UAXKwjiOCEGRzdHKDHrFwgBhQBcsFUAPPFiP6AhPLassfyz/JgED7AJJfA+ICASAHDgIBIAgNAgFYCQoAPbKd+1E0IEBQNch9AQwAsjKB8v/ydABgQEI9ApvoTGACASALDAAZrc52omhAIGuQ64X/wAAZrx32omhAEGuQ64WPwAARuMl+1E0NcLH4AFm9JCtvaiaECAoGuQ+gIYRw1AgIR6STfSmRDOaQPp/5g3gSgBt4EBSJhxWfMYQE+PKDCNcYINMf0x/THwL4I7vyZO1E0NMf0x/T//QE0VFDuvKhUVG68qIF+QFUEGT5EPKj+AAkpMjLH1JAyx9SMMv/UhD0AMntVPgPAdMHIcAAn2xRkyDXSpbTB9QC+wDoMOAhwAHjACHAAuMAAcADkTDjDQOkyMsfEssfy/8QERITAG7SB/oA1NQi+QAFyMoHFcv/ydB3dIAYyMsFywIizxZQBfoCFMtrEszMyXP7AMhAFIEBCPRR8qcCAHCBAQjXGPoA0z/IVCBHgQEI9FHyp4IQbm90ZXB0gBjIywXLAlAGzxZQBPoCFMtqEssfyz/Jc/sAAgBsgQEI1xj6ANM/MFIkgQEI9Fnyp4IQZHN0cnB0gBjIywXLAlAFzxZQA/oCE8tqyx8Syz/Jc/sAAAr0AMntVAj45Sg=';

let walletV4R2Code: Cell | undefined;

/**
 * The account's withdraw-auth identity: its 32-byte ed25519 public key, lowercase `0x` hex. A TON
 * address is `hash(StateInit)` and cannot be inverted, so the pubkey — not the address — is the
 * relay's deposit owner, withdraw sender and hub-wallet identity.
 */
export function tonIdentityBytes(publicKey: string): Hex {
  const hex = publicKey.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`[tonIdentityBytes] expected a 32-byte hex ed25519 public key, got "${publicKey}"`);
  }
  return `0x${hex.toLowerCase()}`;
}

/**
 * The wallet-v4R2 address for a 32-byte public key: the account id of its StateInit (data = seqno 0 ‖
 * subwallet id ‖ pubkey ‖ empty plugins). This is the address a raw-key TON wallet sends from and the
 * one a release to this identity pays. A wallet of another version (e.g. W5) has a different address
 * for the same key.
 */
export function tonWalletAddress(publicKey: string): Address {
  const pubkey = Buffer.from(tonIdentityBytes(publicKey).slice(2), 'hex');
  walletV4R2Code ??= Cell.fromBoc(Buffer.from(WALLET_V4R2_CODE_BOC, 'base64'))[0];
  if (!walletV4R2Code) throw new Error('[tonWalletAddress] wallet-v4R2 code cell failed to decode');
  const data = beginCell().storeUint(0, 32).storeUint(TON_SUBWALLET_ID, 32).storeBuffer(pubkey).storeBit(0).endCell();
  return contractAddress(0, { code: walletV4R2Code, data });
}

/** The 32-byte account hash a TON release pays, as `0x` hex — the recipient word the NEAR contract reads. */
export function tonAddressHash(address: Address | string): Hex {
  const parsed = typeof address === 'string' ? Address.parse(address) : address;
  return `0x${Buffer.from(parsed.hash).toString('hex')}`;
}

/** Canonical raw `workchain:hex` form, for comparing addresses given in any friendly or raw variant. */
export function normalizeTonAddress(address: string): string {
  return Address.parse(address).toRawString();
}

/**
 * The binary-comment body carrying a 32-byte payload hash: an op prefix of 0, then the raw 32 bytes.
 * The body of a native TON deposit, and the `forward_payload` of a jetton deposit.
 */
export function buildTonCommentBody(payloadHash: string): Cell {
  const bytes = Buffer.from(payloadHash.replace(/^0x/, ''), 'hex');
  if (bytes.length !== 32) throw new Error(`[buildTonCommentBody] payloadHash must be 32 bytes, got ${bytes.length}`);
  return beginCell().storeUint(0, 32).storeBuffer(bytes).endCell();
}

/**
 * A TEP-74 jetton `transfer` moving `amount` to the reserve with the payload hash in `forward_payload`,
 * sent to the depositor's OWN jetton wallet. `forwardTon` must be large enough for the reserve's jetton
 * wallet to notify the reserve owner — at 1 nanoton the internal transfer bounces and the jettons return.
 */
export function buildJettonDepositBody(opts: {
  reserve: string;
  amount: bigint;
  payloadHash: string;
  responseAddress: string;
  forwardTon: bigint;
}): Cell {
  return beginCell()
    .storeUint(JETTON_TRANSFER_OP, 32)
    .storeUint(0n, 64) // query_id
    .storeCoins(opts.amount)
    .storeAddress(Address.parse(opts.reserve)) // destination OWNER, not its jetton wallet
    .storeAddress(Address.parse(opts.responseAddress)) // excess TON refunds here
    .storeBit(0) // no custom_payload
    .storeCoins(opts.forwardTon)
    .storeBit(1) // forward_payload in a ref
    .storeRef(buildTonCommentBody(opts.payloadHash))
    .endCell();
}

/** The 32-byte memo a comment body carries, or null when the body is not a 32-byte op-0 comment. */
export function parseTonComment(body: Cell): Hex | null {
  const slice = body.beginParse();
  if (slice.remainingBits < 32 || slice.loadUint(32) !== 0) return null;
  if (slice.remainingBits < 256) return null;
  return `0x${slice.loadBuffer(32).toString('hex')}`;
}

/** The memo a jetton `transfer_notification` carries in `forward_payload`, or null for any other body. */
export function parseJettonNotificationMemo(body: Cell): Hex | null {
  try {
    const s = body.beginParse();
    if (s.remainingBits < 32 || s.loadUint(32) !== JETTON_TRANSFER_NOTIFICATION_OP) return null;
    s.loadUintBig(64); // query_id
    s.loadCoins(); // amount
    s.loadAddress(); // sender
    const inRef = s.loadBit();
    return parseTonComment(inRef ? s.loadRef() : s.asCell());
  } catch {
    return null;
  }
}

/**
 * The readable line a scheme-5 withdrawal `signData`s (payload type `txt`), so the wallet shows text
 * rather than opaque bytes. Must be byte-identical to the NEAR contract's rebuild.
 */
export function tonWithdrawSignText(messageHash: string): string {
  const hex = messageHash.startsWith('0x') ? messageHash : `0x${messageHash}`;
  return `SODAX withdrawal\nmessage: ${hex.toLowerCase()}`;
}

/**
 * The bytes a TonConnect `signData` has the wallet sign, before sha256: `0xffff ‖ "ton-connect/sign-data/"
 * ‖ workchain (i32 BE) ‖ addressHash ‖ domainLen (u32 BE) ‖ domain ‖ timestamp (u64 BE) ‖ "txt"|"bin" ‖
 * payloadLen (u32 BE) ‖ payload`. A raw-key provider signs `sha256` of this to produce what a wallet would.
 */
export function tonSignDataMessage(p: {
  workchain: number;
  addressHash: Uint8Array;
  domain: string;
  timestamp: number;
  payload: Uint8Array;
  payloadType: 'txt' | 'bin';
}): Buffer {
  if (p.addressHash.length !== 32) {
    throw new Error(`[tonSignDataMessage] addressHash must be 32 bytes, got ${p.addressHash.length}`);
  }
  const domain = Buffer.from(p.domain, 'utf8');
  const workchain = Buffer.alloc(4);
  workchain.writeInt32BE(p.workchain, 0);
  const domainLen = Buffer.alloc(4);
  domainLen.writeUInt32BE(domain.length, 0);
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64BE(BigInt(p.timestamp), 0);
  const payloadLen = Buffer.alloc(4);
  payloadLen.writeUInt32BE(p.payload.length, 0);
  return Buffer.concat([
    Buffer.from([0xff, 0xff]),
    Buffer.from('ton-connect/sign-data/', 'ascii'),
    workchain,
    Buffer.from(p.addressHash),
    domainLen,
    domain,
    timestamp,
    Buffer.from(p.payloadType, 'ascii'),
    payloadLen,
    Buffer.from(p.payload),
  ]);
}
