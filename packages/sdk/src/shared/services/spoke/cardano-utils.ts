/**
 * Cardano helpers for the MPC-relay flow: address rules, the withdraw-auth identity, the CIP-20 deposit
 * metadata and the CIP-30 `signData` handling. The bytes are pinned to the relay's contract by
 * `cardano-test-vectors.ts`; any divergence breaks signature verification or the release.
 *
 * Only mainnet key-hash payment addresses (enterprise or base) are valid: ADA sent to a script payment
 * address without a datum is unspendable, and pointer, reward and Byron addresses are not release targets.
 */
import { blake2b } from '@noble/hashes/blake2b';
import { base58, bech32 } from '@scure/base';
import type { CardanoDataSignature, CardanoDepositMetadata, CardanoSignDataWire } from '@sodax/types';
import { bytesToHex, hexToBytes, type Hex } from 'viem';
import { decodeCbor, type CborValue } from './cardano-cbor.js';

/** Smallest release the relay pays, in lovelace (1 ADA); below it the burned wrapped ADA is never paid out. */
export const CARDANO_MIN_RELEASE_LOVELACE = 1_000_000n;

const KEY_HASH_LEN = 28;
const ENTERPRISE_LEN = 1 + KEY_HASH_LEN;
const BASE_LEN = 1 + 2 * KEY_HASH_LEN;
const MAINNET_NETWORK_ID = 1;
const MAINNET_HRP = 'addr';
/** Longest address string accepted; real ones are about 110 characters. Bounds the bech32 and base58 work. */
const MAX_ADDRESS_CHARS = 200;
/** Byron addresses are base58 of CBOR `[#6.24(bytes), crc32]`: array(2), tag 24, bstr. */
const BYRON_CBOR_PREFIX = [0x82, 0xd8, 0x18];

/** Same size bounds the relay enforces before decoding a `signData` result. */
const MAX_COSE_SIGN1_BYTES = 1024;
const MAX_COSE_KEY_BYTES = 128;

/** A decoded mainnet payment address: the raw bytes a release pays, and the key hash that identifies it. */
export type ParsedCardanoAddress = {
  /** Raw address bytes: 29 (enterprise) or 57 (base). */
  bytes: Uint8Array;
  kind: 'base' | 'enterprise';
  /** 28-byte payment key hash. */
  paymentHash: Uint8Array;
};

/** Decode raw address bytes under the recipient rule; throws a specific error for every other kind, length or network. */
function parseCardanoAddressBytes(raw: Uint8Array): ParsedCardanoAddress {
  const header = raw[0];
  if (header === undefined) throw new Error('Cardano address is empty');
  const type = header >> 4;
  const networkId = header & 0x0f;
  if (type === 8) throw new Error('Byron (legacy) Cardano addresses are not supported; use a Shelley addr… address');
  if (type === 4 || type === 5) {
    throw new Error('Cardano pointer addresses are not supported; use an enterprise or base address');
  }
  if (type === 14 || type === 15) throw new Error('Cardano reward (stake) addresses cannot receive payments');
  if (type > 7) throw new Error(`unknown Cardano address header type ${type}`);

  const kind = type <= 3 ? 'base' : 'enterprise';
  const expectedLen = kind === 'base' ? BASE_LEN : ENTERPRISE_LEN;
  if (raw.length !== expectedLen)
    throw new Error(`Cardano ${kind} address must be ${expectedLen} bytes, got ${raw.length}`);
  // Header bit 0 set marks a script payment credential (types 1, 3, 7).
  if ((type & 1) === 1) {
    throw new Error(
      'Cardano address has a script payment credential; only key-hash payment addresses are accepted (ADA sent to a script without a datum is unspendable)',
    );
  }
  if (networkId !== MAINNET_NETWORK_ID) {
    throw new Error(`Cardano address network id ${networkId} is not mainnet (expected ${MAINNET_NETWORK_ID})`);
  }
  const bytes = Uint8Array.from(raw);
  return { bytes, kind, paymentHash: bytes.slice(1, 1 + KEY_HASH_LEN) };
}

function isByronBase58(address: string): boolean {
  try {
    const raw = base58.decode(address);
    return BYRON_CBOR_PREFIX.every((b, i) => raw[i] === b);
  } catch {
    return false;
  }
}

/** Decode a bech32 mainnet payment address (`addr1…`); throws unless it is a key-hash enterprise or base address. */
export function parseCardanoAddress(address: string): ParsedCardanoAddress {
  if (address.length > MAX_ADDRESS_CHARS) {
    throw new Error(`Cardano address is ${address.length} characters, above the ${MAX_ADDRESS_CHARS}-character limit`);
  }
  let decoded: { prefix: string; words: number[] };
  try {
    // Base addresses are 103+ characters, beyond bech32's default 90-character limit.
    decoded = bech32.decode(address as `${string}1${string}`, MAX_ADDRESS_CHARS);
  } catch (error) {
    if (isByronBase58(address)) {
      throw new Error('Byron (legacy) Cardano addresses are not supported; use a Shelley addr… address');
    }
    throw new Error(`invalid Cardano bech32 address: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = parseCardanoAddressBytes(bech32.fromWords(decoded.words));
  if (decoded.prefix !== MAINNET_HRP) {
    throw new Error(`Cardano address prefix "${decoded.prefix}" is not mainnet (expected "${MAINNET_HRP}")`);
  }
  return parsed;
}

/** The recipient bytes of a release to `address`: the full raw address (29 or 57 bytes), not a padded word. */
export function cardanoRecipientBytes(address: string): Hex {
  return bytesToHex(parseCardanoAddress(address).bytes);
}

/** The withdraw-auth identity of `address`: its 28-byte payment key hash. */
export function cardanoIdentityBytes(address: string): Hex {
  return bytesToHex(parseCardanoAddress(address).paymentHash);
}

/** The `addr1…` address of a release recipient (the raw 29- or 57-byte form `cardanoRecipientBytes` produces). */
export function cardanoAddressFromRecipientBytes(recipient: string): string {
  const raw = hexToBytes(recipient as Hex);
  if (raw.length !== ENTERPRISE_LEN && raw.length !== BASE_LEN) {
    throw new Error(
      `Cardano recipient must be the raw address (${ENTERPRISE_LEN} or ${BASE_LEN} bytes), got ${raw.length}; a ${KEY_HASH_LEN}-byte key hash cannot be turned back into an address`,
    );
  }
  const parsed = parseCardanoAddressBytes(raw);
  return bech32.encode(MAINNET_HRP, bech32.toWords(parsed.bytes), MAX_ADDRESS_CHARS);
}

/**
 * The transaction metadata a deposit attaches: CIP-20 label 674 with the payload hash as 64 lowercase hex
 * characters and no `0x`, since CIP-20 caps each string at 64 bytes.
 */
export function cardanoDepositMetadata(payloadHash: string): CardanoDepositMetadata {
  const hash = payloadHash.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error(`payloadHash must be 32 bytes of hex, got "${payloadHash.slice(0, 80)}"`);
  }
  return { '674': { msg: [hash.toLowerCase()] } };
}

/**
 * The payload a scheme-7 wallet signs: the ASCII text `0x<lowercase hex of the message hash>` (66 bytes), so
 * wallets show readable text. It is signed unhashed.
 */
export function cardanoSignDataPayload(messageHash: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(messageHash)) {
    throw new Error(`messageHash must be a 0x-prefixed 32-byte hex string, got "${messageHash.slice(0, 80)}"`);
  }
  return bytesToHex(new TextEncoder().encode(messageHash.toLowerCase()));
}

function boundedHexBytes(value: string, label: string, maxBytes: number): Uint8Array {
  const hex = value.replace(/^0x/i, '');
  // Bound the size before scanning the string.
  if (hex.length > maxBytes * 2)
    throw new Error(`${label} is ${Math.ceil(hex.length / 2)} bytes, above the ${maxBytes}-byte limit`);
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`${label} must be non-empty hex CBOR`);
  }
  return hexToBytes(`0x${hex}`);
}

function decodeOrThrow(bytes: Uint8Array, label: string): CborValue {
  try {
    return decodeCbor(bytes);
  } catch (error) {
    throw new Error(`${label} malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Turn a wallet's CIP-30 `DataSignature` into the scheme-7 withdraw-auth fields. It fails early and specifically
 * on the two ways a real wallet goes wrong before the relay would refuse it: signing a different payload (for
 * example a hashed one), and signing with a key other than the withdraw `sender`. The COSE signature itself is
 * verified by the relay, not here.
 */
export function cardanoSignDataFields(
  dataSignature: CardanoDataSignature,
  messageHash: Hex,
  sender: Hex,
): { signature: Hex; cardanoSignData: CardanoSignDataWire } {
  const sign1Bytes = boundedHexBytes(dataSignature.signature, 'COSE_Sign1', MAX_COSE_SIGN1_BYTES);
  const keyBytes = boundedHexBytes(dataSignature.key, 'COSE_Key', MAX_COSE_KEY_BYTES);

  let sign1 = decodeOrThrow(sign1Bytes, 'COSE_Sign1');
  if (sign1 !== null && typeof sign1 === 'object' && 'tag' in sign1) sign1 = sign1.value;
  if (!Array.isArray(sign1) || sign1.length !== 4)
    throw new Error('COSE_Sign1 malformed: expected an array of 4 items');
  const [, , payload, signature] = sign1;
  if (!(payload instanceof Uint8Array)) throw new Error('COSE_Sign1 malformed: payload must be attached bytes');
  if (!(signature instanceof Uint8Array) || signature.length !== 64) {
    throw new Error('COSE_Sign1 malformed: signature must be 64 bytes');
  }
  if (bytesToHex(payload) !== cardanoSignDataPayload(messageHash)) {
    throw new Error(
      'wallet signed a payload other than "0x" + hex(messageHash); the scheme-7 payload must be signed unhashed',
    );
  }

  const key = decodeOrThrow(keyBytes, 'COSE_Key');
  if (!(key instanceof Map)) throw new Error('COSE_Key malformed: expected a map');
  const publicKey = key.get(-2n);
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== 32) {
    throw new Error('COSE_Key malformed: -2 must be a 32-byte ed25519 public key');
  }
  const signerHash = bytesToHex(blake2b(publicKey, { dkLen: KEY_HASH_LEN }));
  if (signerHash !== sender.toLowerCase()) {
    throw new Error(`wallet signed with payment key hash ${signerHash}, but the withdrawal sender is ${sender}`);
  }

  return {
    signature: bytesToHex(signature),
    cardanoSignData: { coseSign1: bytesToHex(sign1Bytes), coseKey: bytesToHex(keyBytes) },
  };
}
