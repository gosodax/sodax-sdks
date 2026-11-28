// Byte-identical to the NEAR contract / ingest encoders: any divergence breaks withdrawal signature recovery or
// deposit memo matching.
import { numberToHex, sha256, type Hex } from 'viem';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * base58check (or 41-prefixed hex) → 41-prefixed hex. Strict: these bytes become MPC-relay recipients and withdraw
 * identities, so a typo that still decodes must throw rather than resolve to someone else's account.
 */
export function tronBase58ToHex(addr: string): string {
  const hex = addr.startsWith('0x') ? addr.slice(2) : addr;
  if (/^41[0-9a-fA-F]{40}$/.test(hex)) return hex;
  if (addr.startsWith('0x')) throw new Error(`invalid Tron hex address (expected 0x41 + 20 bytes): ${addr}`);

  let n = 0n;
  for (const c of addr) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error(`invalid base58 char in Tron address: ${addr}`);
    n = n * 58n + BigInt(i);
  }
  // 25 bytes with a leading 0x41 (no leading zero bytes), so the big-integer form is exactly 50 hex chars.
  const h = n.toString(16).padStart(50, '0');
  if (addr.startsWith('1') || h.length !== 50 || !h.startsWith('41')) {
    throw new Error(`invalid Tron address (expected 25 bytes with 0x41 version): ${addr}`);
  }
  const payload = h.slice(0, 42);
  const checksum = sha256(sha256(`0x${payload}`)).slice(2, 10);
  if (h.slice(42) !== checksum) throw new Error(`invalid Tron address checksum: ${addr}`);
  return payload;
}

/** Insert a 32-byte memo as protobuf field 10 (tag 0x52, len 0x20) before the first field numbered ≥ 10. */
export function spliceMemo(rawHex: string, memoHex: string): string {
  const clean = memoHex.replace(/^0x/, '');
  if (clean.length !== 64) throw new Error(`memo must be 32 bytes (64 hex chars), got ${clean.length}`);
  const buf = Buffer.from(rawHex, 'hex');
  const readVarint = (p: number): [number, number] => {
    let v = 0;
    let s = 0;
    let i = p;
    for (;;) {
      const b = buf[i++];
      if (b === undefined) throw new Error('malformed varint in raw_data');
      v |= (b & 0x7f) << s;
      if (!(b & 0x80)) break;
      s += 7;
    }
    return [v, i];
  };
  let pos = 0;
  let at = buf.length;
  while (pos < buf.length) {
    const start = pos;
    const [tag, aft] = readVarint(pos);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field >= 10) {
      at = start;
      break;
    }
    if (wire === 0) [, pos] = readVarint(aft);
    else if (wire === 2) {
      const [len, al] = readVarint(aft);
      pos = al + len;
    } else throw new Error(`unexpected protobuf wire type ${wire} while splicing memo`);
  }
  return `${buf.subarray(0, at).toString('hex')}5220${clean}${buf.subarray(at).toString('hex')}`;
}

type ProtoField = { field: number; varint?: bigint; bytes?: Uint8Array; start: number; end: number };

/** Varints read as bigint, since a sun amount can exceed 2^31. */
function readProtoFields(buf: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let pos = 0;
  const readVarint = (): bigint => {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      const b = buf[pos++];
      if (b === undefined) break;
      value |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return value;
    }
    throw new Error('malformed protobuf varint');
  };
  while (pos < buf.length) {
    const start = pos;
    const tag = readVarint();
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (wire === 0) {
      const varint = readVarint();
      fields.push({ field, varint, start, end: pos });
    } else if (wire === 2) {
      const len = Number(readVarint());
      if (pos + len > buf.length) throw new Error('truncated protobuf field');
      fields.push({ field, bytes: buf.subarray(pos, pos + len), start, end: pos + len });
      pos += len;
    } else throw new Error(`unexpected protobuf wire type ${wire}`);
  }
  return fields;
}

function varintHex(value: number | bigint): string {
  const out: number[] = [];
  let n = BigInt(value);
  while (n > 0x7fn) {
    out.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  out.push(Number(n));
  return Buffer.from(out).toString('hex');
}

/** Replace `expiration` (field 8, ms since epoch). Unsigned bytes only: the txID and any signature change with it. */
export function setExpiration({ rawHex, expiration }: { rawHex: string; expiration: number }): string {
  const buf = Buffer.from(rawHex.replace(/^0x/, ''), 'hex');
  const fields = readProtoFields(buf).filter(f => f.field === 8);
  const [current] = fields;
  if (fields.length !== 1 || !current) throw new Error(`[tron] expected one expiration field, got ${fields.length}`);
  const field8 = `40${varintHex(expiration)}`;
  return `${buf.subarray(0, current.start).toString('hex')}${field8}${buf.subarray(current.end).toString('hex')}`;
}

/** A repeated field is refused because protobuf's last-wins would hide it. */
function singleField(fields: ProtoField[], field: number): ProtoField | undefined {
  const found = fields.filter(f => f.field === field);
  if (found.length > 1) throw new Error(`field ${field} appears ${found.length} times`);
  return found[0];
}

const bytesHex = (f: ProtoField | undefined): string => (f?.bytes ? Buffer.from(f.bytes).toString('hex') : '');
const varintOf = (f: ProtoField | undefined): bigint => f?.varint ?? 0n;

const TRANSFER_CONTRACT = 1n;
const TRIGGER_SMART_CONTRACT = 31n;
const TRC20_TRANSFER_SELECTOR = 'a9059cbb';

type DecodedTransaction = { raw: ProtoField[]; contracts: number; type: bigint; value: ProtoField[] };

function decodeTransaction(rawHex: string): DecodedTransaction {
  const raw = readProtoFields(Buffer.from(rawHex.replace(/^0x/, ''), 'hex'));
  const contracts = raw.filter(f => f.field === 11);
  const contract = readProtoFields(contracts[0]?.bytes ?? new Uint8Array());
  const any = readProtoFields(singleField(contract, 2)?.bytes ?? new Uint8Array());
  return {
    raw,
    contracts: contracts.length,
    type: varintOf(singleField(contract, 1)),
    value: readProtoFields(singleField(any, 2)?.bytes ?? new Uint8Array()),
  };
}

export type Trc20TransferCall = { owner: string; contract: string; parameter: string };

/** `undefined` for a native TRX transfer; throws for anything other than those two deposit shapes. */
export function readTrc20TransferCall(rawHex: string): Trc20TransferCall | undefined {
  const { contracts, type, value } = decodeTransaction(rawHex);
  if (contracts !== 1) throw new Error(`[tron] expected one contract, got ${contracts}`);
  if (type === TRANSFER_CONTRACT) return undefined;
  const calldata = bytesHex(singleField(value, 4));
  if (type !== TRIGGER_SMART_CONTRACT || !calldata.startsWith(TRC20_TRANSFER_SELECTOR)) {
    throw new Error(`[tron] not a TRX or TRC-20 transfer (contract type ${type})`);
  }
  return {
    owner: tronHashToBase58(bytesHex(singleField(value, 1))),
    contract: tronHashToBase58(bytesHex(singleField(value, 2))),
    parameter: calldata.slice(TRC20_TRANSFER_SELECTOR.length),
  };
}

export type ExpectedDepositTransfer = {
  owner: string;
  reserve: string;
  amount: bigint;
  /** Omitted for native TRX. */
  token?: string;
  maxFeeLimitSun: number;
};

/**
 * Throws unless the node-built bytes are exactly the requested transfer (one contract, no memo yet, fee limit within
 * budget): the SDK signs these bytes, so the node is not trusted for them.
 */
export function assertDepositTransfer(rawHex: string, expected: ExpectedDepositTransfer): void {
  const reject = (reason: string): never => {
    throw new Error(`[tron] node-built deposit transfer rejected: ${reason}`);
  };
  const lower = (addr: string): string => tronBase58ToHex(addr).toLowerCase();

  const { raw, contracts, type, value } = decodeTransaction(rawHex);
  if (raw.some(f => f.field === 10)) reject('it already carries a data field');
  if (contracts !== 1) reject(`expected one contract, got ${contracts}`);
  if (varintOf(singleField(raw, 18)) > BigInt(expected.maxFeeLimitSun)) reject('fee_limit above the deposit budget');

  if (bytesHex(singleField(value, 1)) !== lower(expected.owner)) reject('owner is not the depositor');

  if (expected.token === undefined) {
    if (type !== TRANSFER_CONTRACT) reject(`expected a TransferContract, got type ${type}`);
    if (bytesHex(singleField(value, 2)) !== lower(expected.reserve)) reject('recipient is not the reserve');
    if (varintOf(singleField(value, 3)) !== expected.amount) reject('amount differs from the requested amount');
    return;
  }

  if (type !== TRIGGER_SMART_CONTRACT) reject(`expected a TriggerSmartContract, got type ${type}`);
  if (bytesHex(singleField(value, 2)) !== lower(expected.token)) reject('contract is not the deposit token');
  if (varintOf(singleField(value, 3)) !== 0n) reject('call_value must be zero');
  if (varintOf(singleField(value, 5)) !== 0n || singleField(value, 6)) reject('it attaches a TRC-10 token');
  const calldata = `${TRC20_TRANSFER_SELECTOR}${encodeTrc20TransferParams(expected.reserve, expected.amount)}`;
  if (bytesHex(singleField(value, 4)) !== calldata) reject('calldata is not transfer(reserve, amount)');
}

/** The `broadcasthex` envelope: field 1 holds the raw_data bytes, then one field 2 per signature. */
export function assembleBroadcastHex({
  rawHex,
  signatures,
}: {
  rawHex: string;
  signatures: readonly string[];
}): string {
  const field = (tag: string, hex: string): string => `${tag}${varintHex(hex.length / 2)}${hex}`;
  return field('0a', rawHex) + signatures.map(sig => field('12', sig.replace(/^0x/, ''))).join('');
}

/** Right-aligned 32-byte word of the 20-byte body (0x41 prefix dropped). */
export function tronAddressToWord(addr: string): string {
  const body = tronBase58ToHex(addr).replace(/^41/, '');
  return body.padStart(64, '0');
}

/** As TronGrid `triggersmartcontract` wants: the two 32-byte words without the selector and without `0x`. */
export function encodeTrc20TransferParams(to: string, amount: bigint): string {
  return `${tronAddressToWord(to)}${numberToHex(amount, { size: 32 }).slice(2)}`;
}

/** Scheme-1 identity: the 20-byte address hash (0x41 dropped), used as withdraw `sender` and hub-wallet salt. */
export function tronIdentityBytes(base58Addr: string): Hex {
  return `0x${tronBase58ToHex(base58Addr).slice(2)}`;
}

/** Inverse of {@link tronIdentityBytes} / {@link tronBase58ToHex}; accepts 20-byte hash or 0x41-prefixed hex. */
export function tronHashToBase58(hashHex: string): string {
  let h = hashHex.replace(/^0x/, '').toLowerCase();
  if (h.length === 40) h = `41${h}`; // bare 20-byte hash → add the version byte
  if (!/^41[0-9a-f]{40}$/.test(h)) throw new Error(`invalid Tron address hex: ${hashHex}`);
  const payload = Uint8Array.from(Buffer.from(h, 'hex'));
  const checksum = Uint8Array.from(Buffer.from(sha256(sha256(`0x${h}`)).slice(2), 'hex')).slice(0, 4);
  const full = Uint8Array.from([...payload, ...checksum]);
  let n = BigInt(`0x${Buffer.from(full).toString('hex')}`);
  let s = '';
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of full) {
    if (b === 0) s = `1${s}`;
    else break;
  }
  return s;
}

/** Re-exported so existing Tron imports keep working. */
export { computeSignedMessageHash, type SignedWalletMessage } from './mpc-message.js';
