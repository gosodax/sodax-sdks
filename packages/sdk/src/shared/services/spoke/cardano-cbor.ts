/**
 * The CBOR subset needed to read a CIP-30 `signData` result (COSE_Sign1 / COSE_Key): a strict decoder that
 * accepts only definite-length major types 0..5, tag 18 and the simple values false/true/null. Anything
 * else is refused, so a malformed wallet response fails here rather than at the relay.
 */

/** A decoded CBOR item. Integers are bigint so u64 and negative values never lose precision. */
export type CborValue =
  | bigint
  | Uint8Array
  | string
  | boolean
  | null
  | CborValue[]
  | Map<CborKey, CborValue>
  | { tag: number; value: CborValue };

/** Map keys the decoder keeps: integers (as bigint) and text. */
export type CborKey = bigint | string;

const MAX_DEPTH = 4;

class Reader {
  pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  byte(): number {
    const b = this.buf[this.pos];
    if (b === undefined) throw new Error('unexpected end of CBOR input');
    this.pos++;
    return b;
  }

  take(n: number): Uint8Array {
    if (n > this.buf.length - this.pos) {
      throw new Error(`CBOR length ${n} overruns the ${this.buf.length - this.pos} remaining bytes`);
    }
    const out = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  get done(): boolean {
    return this.pos === this.buf.length;
  }
}

/** Read the argument of a head whose additional info is `info`. */
function readArg(r: Reader, info: number): bigint {
  if (info < 24) return BigInt(info);
  const width = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
  if (width === 0) throw new Error(`unsupported CBOR additional info ${info} (indefinite lengths are rejected)`);
  let v = 0n;
  for (const b of r.take(width)) v = (v << 8n) | BigInt(b);
  return v;
}

function readLength(r: Reader, info: number): number {
  const n = readArg(r, info);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`CBOR length ${n} is too large`);
  return Number(n);
}

function readItem(r: Reader, depth: number, top: boolean): CborValue {
  if (depth > MAX_DEPTH) throw new Error(`CBOR nesting deeper than ${MAX_DEPTH}`);
  const ib = r.byte();
  const major = ib >> 5;
  const info = ib & 0x1f;
  switch (major) {
    case 0:
      return readArg(r, info);
    case 1:
      return -1n - readArg(r, info);
    case 2:
      return r.take(readLength(r, info));
    case 3:
      return new TextDecoder('utf-8', { fatal: true }).decode(r.take(readLength(r, info)));
    case 4: {
      const n = readLength(r, info);
      const out: CborValue[] = [];
      for (let i = 0; i < n; i++) out.push(readItem(r, depth + 1, false));
      return out;
    }
    case 5: {
      const n = readLength(r, info);
      const out = new Map<CborKey, CborValue>();
      for (let i = 0; i < n; i++) {
        const k = readItem(r, depth + 1, false);
        if (typeof k !== 'bigint' && typeof k !== 'string') {
          throw new Error('CBOR map key must be an integer or text');
        }
        if (out.has(k)) throw new Error(`duplicate CBOR map key ${String(k)}`);
        out.set(k, readItem(r, depth + 1, false));
      }
      return out;
    }
    case 6: {
      const tag = readArg(r, info);
      // COSE_Sign1 may carry its registered tag 18 at the top level only.
      if (!top || tag !== 18n) throw new Error(`unsupported CBOR tag ${tag}`);
      return { tag: 18, value: readItem(r, depth + 1, false) };
    }
    default:
      if (ib === 0xf4) return false;
      if (ib === 0xf5) return true;
      if (ib === 0xf6) return null;
      throw new Error(`unsupported CBOR initial byte 0x${ib.toString(16).padStart(2, '0')}`);
  }
}

/** Decode exactly one CBOR item; trailing bytes are an error. */
export function decodeCbor(buf: Uint8Array): CborValue {
  const r = new Reader(buf);
  const value = readItem(r, 0, true);
  if (!r.done) throw new Error(`${buf.length - r.pos} trailing bytes after the CBOR item`);
  return value;
}
