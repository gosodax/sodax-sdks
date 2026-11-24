/**
 * Transparent-only Zcash v5 transactions: serialization and the ZIP-244 signature digest.
 *
 * The digest is written here rather than taken from a library because `@bitgo/utxo-lib` computes it wrong
 * (value and scriptCode swapped in `txin_sig_digest`, and `hash_type`, `amounts` and `scriptpubkeys` missing
 * from `transparent_sig_digest`), producing signatures the network rejects. It is tested against a real,
 * network-accepted mainnet transaction. Spec: https://zips.z.cash/zip-0244
 */
import { blake2b } from '@noble/hashes/blake2b';
import { concatBytes, hexToBytes } from 'viem';

/** NU5+ v5 transaction version group id. */
export const ZCASH_V5_VERSION_GROUP_ID = 0x26a7270a;
export const SIGHASH_ALL = 0x01;
/** Input sequence that opts out of relative locktime. */
const FINAL_SEQUENCE = 0xffffffff;

/** A transparent input, with the value and script of the output it spends. */
export interface Zip244Input {
  /** Previous txid in RPC display (big-endian) hex. */
  txid: string;
  vout: number;
  value: bigint;
  /** Hex locking script of the spent output. */
  scriptPubKey: string;
  /** Hex unlocking script; empty while unsigned. */
  scriptSig?: string;
}

export interface Zip244Output {
  value: bigint;
  scriptPubKey: string;
}

export interface Zip244Transaction {
  consensusBranchId: number;
  lockTime: number;
  expiryHeight: number;
  inputs: Zip244Input[];
  outputs: Zip244Output[];
}

const hexBytes = (hex: string): Uint8Array => hexToBytes(`0x${hex.replace(/^0x/, '')}`);

/** An RPC display txid in the little-endian byte order used on the wire. */
const internalTxid = (txid: string): Uint8Array => hexBytes(txid).reverse();

/** Little-endian unsigned integer of `size` bytes. */
const le = (n: bigint, size: number): Uint8Array => {
  const out = new Uint8Array(size);
  let v = n;
  for (let i = 0; i < size; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
};

class Writer {
  private readonly parts: Uint8Array[] = [];
  u8(n: number): this {
    this.parts.push(new Uint8Array([n & 0xff]));
    return this;
  }
  u32(n: number): this {
    this.parts.push(le(BigInt(n >>> 0), 4));
    return this;
  }
  i32(n: number): this {
    return this.u32(n | 0);
  }
  u64(n: bigint): this {
    this.parts.push(le(n, 8));
    return this;
  }
  raw(b: Uint8Array): this {
    this.parts.push(b);
    return this;
  }
  compactSize(n: number): this {
    if (n < 0xfd) return this.u8(n);
    if (n <= 0xffff) return this.u8(0xfd).raw(le(BigInt(n), 2));
    return this.u8(0xfe).u32(n);
  }
  varSlice(b: Uint8Array): this {
    return this.compactSize(b.length).raw(b);
  }
  end(): Uint8Array {
    return concatBytes(this.parts);
  }
}

const personal16 = (tag: string): Uint8Array => {
  const b = new Uint8Array(16);
  for (let i = 0; i < tag.length; i++) b[i] = tag.charCodeAt(i);
  return b;
};

const blake = (tag: string | Uint8Array, data: Uint8Array): Uint8Array =>
  blake2b(data, { dkLen: 32, personalization: typeof tag === 'string' ? personal16(tag) : tag });

/** Serialize a transparent-only v5 transaction (no Sapling or Orchard bundles). */
export function serializeZcashV5(tx: Zip244Transaction): Uint8Array {
  const w = new Writer()
    .i32(5 | (1 << 31)) // version with the overwintered bit
    .u32(ZCASH_V5_VERSION_GROUP_ID)
    .u32(tx.consensusBranchId)
    .u32(tx.lockTime)
    .u32(tx.expiryHeight)
    .compactSize(tx.inputs.length);
  for (const input of tx.inputs) {
    w.raw(internalTxid(input.txid))
      .u32(input.vout)
      .varSlice(hexBytes(input.scriptSig ?? ''))
      .u32(FINAL_SEQUENCE);
  }
  w.compactSize(tx.outputs.length);
  for (const output of tx.outputs) w.u64(output.value).varSlice(hexBytes(output.scriptPubKey));
  // Empty Sapling spends, Sapling outputs and Orchard actions.
  return w.compactSize(0).compactSize(0).compactSize(0).end();
}

/** The ZIP-244 digest input `inIndex` signs, for `SIGHASH_ALL`. */
export function zip244SignatureDigest(tx: Zip244Transaction, inIndex: number): Uint8Array {
  const signing = tx.inputs[inIndex];
  if (!signing) throw new Error(`[zip244] no input at index ${inIndex}`);

  const header = blake(
    'ZTxIdHeadersHash',
    new Writer()
      .i32(5 | (1 << 31))
      .u32(ZCASH_V5_VERSION_GROUP_ID)
      .u32(tx.consensusBranchId)
      .u32(tx.lockTime)
      .u32(tx.expiryHeight)
      .end(),
  );

  const prevouts = blake(
    'ZTxIdPrevoutHash',
    tx.inputs.reduce((w, i) => w.raw(internalTxid(i.txid)).u32(i.vout), new Writer()).end(),
  );
  const amounts = blake('ZTxTrAmountsHash', tx.inputs.reduce((w, i) => w.u64(i.value), new Writer()).end());
  const scriptPubKeys = blake(
    'ZTxTrScriptsHash',
    tx.inputs.reduce((w, i) => w.varSlice(hexBytes(i.scriptPubKey)), new Writer()).end(),
  );
  const sequences = blake('ZTxIdSequencHash', tx.inputs.reduce(w => w.u32(FINAL_SEQUENCE), new Writer()).end());
  const outputs = blake(
    'ZTxIdOutputsHash',
    tx.outputs.reduce((w, o) => w.u64(o.value).varSlice(hexBytes(o.scriptPubKey)), new Writer()).end(),
  );
  // Value BEFORE the scriptCode — the order utxo-lib gets backwards.
  const txin = blake(
    'Zcash___TxInHash',
    new Writer()
      .raw(internalTxid(signing.txid))
      .u32(signing.vout)
      .u64(signing.value)
      .varSlice(hexBytes(signing.scriptPubKey))
      .u32(FINAL_SEQUENCE)
      .end(),
  );
  const transparent = blake(
    'ZTxIdTranspaHash',
    new Writer()
      .u8(SIGHASH_ALL)
      .raw(prevouts)
      .raw(amounts)
      .raw(scriptPubKeys)
      .raw(sequences)
      .raw(outputs)
      .raw(txin)
      .end(),
  );
  const sapling = blake('ZTxIdSaplingHash', new Uint8Array(0));
  const orchard = blake('ZTxIdOrchardHash', new Uint8Array(0));

  // Personalization is "ZcashTxHash_" followed by the consensus branch id (u32 LE).
  const personalization = personal16('ZcashTxHash_');
  personalization.set(le(BigInt(tx.consensusBranchId >>> 0), 4), 12);
  return blake(personalization, concatBytes([header, transparent, sapling, orchard]));
}
