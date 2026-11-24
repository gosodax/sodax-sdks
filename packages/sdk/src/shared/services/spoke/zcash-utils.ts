/**
 * Zcash transparent helpers for the MPC relay: t-address encoding, the hash160 identity the relay
 * checks withdrawals against, the ZIP-317 fee, and a parser for signed v5 transactions so a deposit can
 * be checked before it is broadcast. Signing (the ZIP-244 digest) lives in the wallet provider.
 */
import { blake2b } from '@noble/hashes/blake2b';
import { bytesToHex, concatBytes, hexToBytes, ripemd160, sha256, type Hex } from 'viem';

/** P2PKH version prefix of a mainnet transparent `t1…` address. */
export const ZCASH_MAINNET_P2PKH_PREFIX = '1cb8';

/** Outputs below this many zatoshis are dust — unspendable at the standard fee. */
export const ZCASH_DUST_ZATOSHIS = 54n;

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const sha256d = (bytes: Uint8Array): Uint8Array => sha256(sha256(bytes, 'bytes'), 'bytes');

function base58CheckDecode(value: string): Uint8Array {
  let n = 0n;
  for (const char of value) {
    const digit = B58.indexOf(char);
    if (digit < 0) throw new Error(`[zcash] invalid base58 character '${char}' in ${value}`);
    n = n * 58n + BigInt(digit);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const leadingZeros = value.match(/^1*/)?.[0].length ?? 0;
  const full = new Uint8Array([...new Uint8Array(leadingZeros), ...hexToBytes(`0x${hex}`)]);
  const body = full.subarray(0, full.length - 4);
  const checksum = sha256d(body).subarray(0, 4);
  if (bytesToHex(checksum) !== bytesToHex(full.subarray(full.length - 4))) {
    throw new Error(`[zcash] bad address checksum: ${value}`);
  }
  return body;
}

function base58CheckEncode(body: Uint8Array): string {
  const full = new Uint8Array([...body, ...sha256d(body).subarray(0, 4)]);
  let n = BigInt(bytesToHex(full));
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of full) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/**
 * The 20-byte hash160 a mainnet transparent `t1…` address encodes — the account's withdraw-auth identity
 * and hub-wallet key. Refuses a non-mainnet or non-P2PKH address.
 */
export function zcashIdentityBytes(address: string): Hex {
  const body = base58CheckDecode(address);
  const prefix = bytesToHex(body.subarray(0, 2)).slice(2);
  if (body.length !== 22 || prefix !== ZCASH_MAINNET_P2PKH_PREFIX) {
    throw new Error(`[zcashIdentityBytes] ${address} is not a mainnet transparent P2PKH (t1…) address`);
  }
  return bytesToHex(body.subarray(2));
}

/** The mainnet `t1…` address for a 20-byte hash160 — the inverse of {@link zcashIdentityBytes}. */
export function zcashHashToAddress(hash160: string): string {
  const hash = hexToBytes(hash160.startsWith('0x') ? (hash160 as Hex) : `0x${hash160}`);
  if (hash.length !== 20) throw new Error(`[zcashHashToAddress] expected 20 bytes, got ${hash.length}`);
  return base58CheckEncode(new Uint8Array([...hexToBytes(`0x${ZCASH_MAINNET_P2PKH_PREFIX}`), ...hash]));
}

/** hash160(compressed public key): the identity a transparent address encodes. */
export function zcashHash160(compressedPublicKey: Uint8Array): Hex {
  return ripemd160(sha256(compressedPublicKey, 'bytes'));
}

/** The P2PKH locking script paying `address`, hex without `0x`. */
export function zcashP2pkhScript(address: string): string {
  return `76a914${zcashIdentityBytes(address).slice(2)}88ac`;
}

/** The ZIP-317 conventional fee for a transparent transaction: 5000 zatoshis per logical action, at least 2. */
export function zcashZip317Fee(inputs: number, outputs: number): bigint {
  return 5000n * BigInt(Math.max(2, inputs, outputs));
}

/** One output of a parsed transaction. */
export interface ZcashParsedOutput {
  value: bigint;
  scriptPubKey: string;
}

/**
 * The transparent outputs of a signed v5 transaction. Used to check what a wallet actually signed — the
 * bytes that will be broadcast — rather than trusting the transaction that was requested.
 */
function parseZcashV5(txHex: string) {
  if (!/^(?:0x)?(?:[0-9a-fA-F]{2})+$/.test(txHex)) throw new Error('[zcash] invalid transaction hex');
  const bytes = hexToBytes(txHex.startsWith('0x') ? (txHex as Hex) : `0x${txHex}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const u32 = (): number => {
    const v = view.getUint32(offset, true);
    offset += 4;
    return v;
  };
  const compactSize = (): number => {
    const first = bytes[offset++];
    if (first === undefined) throw new Error('[zcash] truncated transaction');
    if (first < 0xfd) return first;
    if (first === 0xfd) {
      const v = view.getUint16(offset, true);
      offset += 2;
      return v;
    }
    if (first === 0xfe) return u32();
    throw new Error('[zcash] unsupported compact size');
  };

  const header = u32();
  if ((header & 0x7fffffff) !== 5)
    throw new Error(`[zcash] expected a v5 transaction, got version ${header & 0x7fffffff}`);
  if (header !== 0x80000005 || u32() !== 0x26a7270a) throw new Error('[zcash] invalid v5 header');
  offset += 12; // consensusBranchId, lockTime, expiryHeight

  const inputCount = compactSize();
  const prevouts: Uint8Array[] = [];
  const sequences: Uint8Array[] = [];
  for (let i = 0; i < inputCount; i++) {
    prevouts.push(bytes.subarray(offset, offset + 36));
    offset += 36; // outpoint
    // Read the length first: `offset += compactSize()` would read `offset` before the call advances it.
    const scriptSigLength = compactSize();
    offset += scriptSigLength;
    sequences.push(bytes.subarray(offset, offset + 4));
    offset += 4;
  }

  const outputCount = compactSize();
  const encodedOutputsStart = offset;
  const outputs: ZcashParsedOutput[] = [];
  for (let i = 0; i < outputCount; i++) {
    const value = view.getBigUint64(offset, true);
    offset += 8;
    const scriptLength = compactSize();
    outputs.push({ value, scriptPubKey: bytesToHex(bytes.subarray(offset, offset + scriptLength)).slice(2) });
    offset += scriptLength;
  }
  return {
    bytes,
    prevouts,
    sequences,
    outputs,
    encodedOutputs: bytes.subarray(encodedOutputsStart, offset),
    shieldedBundles: bytes.subarray(offset),
  };
}

export function parseZcashV5Outputs(txHex: string): ZcashParsedOutput[] {
  return parseZcashV5(txHex).outputs;
}

/** Parse the signed wire bytes and compute its transparent-only ZIP-244 txid in RPC display order. */
export function inspectZcashV5Deposit(txHex: string): { outputs: ZcashParsedOutput[]; txid: string } {
  const { bytes, prevouts, sequences, outputs, encodedOutputs, shieldedBundles } = parseZcashV5(txHex);
  if (shieldedBundles.length !== 3 || shieldedBundles.some(byte => byte !== 0)) {
    throw new Error('[zcash] expected an unshielded v5 transaction with no trailing bytes');
  }
  const tag = (name: string) => new TextEncoder().encode(name);
  const hash = (data: Uint8Array, personalization: Uint8Array) => blake2b(data, { dkLen: 32, personalization });
  const empty = new Uint8Array();
  const transparent =
    prevouts.length || outputs.length
      ? concatBytes([
          hash(concatBytes(prevouts), tag('ZTxIdPrevoutHash')),
          hash(concatBytes(sequences), tag('ZTxIdSequencHash')),
          hash(encodedOutputs, tag('ZTxIdOutputsHash')),
        ])
      : empty;
  const digest = hash(
    concatBytes([
      hash(bytes.subarray(0, 20), tag('ZTxIdHeadersHash')),
      hash(transparent, tag('ZTxIdTranspaHash')),
      hash(empty, tag('ZTxIdSaplingHash')),
      hash(empty, tag('ZTxIdOrchardHash')),
    ]),
    concatBytes([tag('ZcashTxHash_'), bytes.subarray(8, 12)]),
  );
  return { outputs, txid: bytesToHex(digest.reverse()).slice(2) };
}
