// Strict CBOR subset for CIP-30 `signData` (COSE_Sign1 / COSE_Key): definite-length majors 0..5, tag 18 and
// false/true/null; witness sets may opt into set tag 258 and indefinite-length arrays and maps.

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

  consumeBreak(): boolean {
    if (this.buf[this.pos] !== 0xff) return false;
    this.pos++;
    return true;
  }

  get done(): boolean {
    return this.pos === this.buf.length;
  }
}

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

/** An array or map head's item count, or `undefined` for an indefinite one, which only witness sets may use. */
function itemCount(r: Reader, info: number, witnessSet: boolean): number | undefined {
  return witnessSet && info === 31 ? undefined : readLength(r, info);
}

/** Whether item `i` follows: below a definite count, or before the break (0xff) that ends an indefinite one. */
function hasNext(r: Reader, i: number, count: number | undefined): boolean {
  return count === undefined ? !r.consumeBreak() : i < count;
}

function readItem(r: Reader, depth: number, top: boolean, witnessSet: boolean): CborValue {
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
      const n = itemCount(r, info, witnessSet);
      const out: CborValue[] = [];
      for (let i = 0; hasNext(r, i, n); i++) out.push(readItem(r, depth + 1, false, witnessSet));
      return out;
    }
    case 5: {
      const n = itemCount(r, info, witnessSet);
      const out = new Map<CborKey, CborValue>();
      for (let i = 0; hasNext(r, i, n); i++) {
        const k = readItem(r, depth + 1, false, witnessSet);
        if (typeof k !== 'bigint' && typeof k !== 'string') {
          throw new Error('CBOR map key must be an integer or text');
        }
        if (out.has(k)) throw new Error(`duplicate CBOR map key ${String(k)}`);
        out.set(k, readItem(r, depth + 1, false, witnessSet));
      }
      return out;
    }
    case 6: {
      const tag = readArg(r, info);
      // COSE_Sign1 tag 18 is only valid at the top level.
      if (!(top && tag === 18n) && !(witnessSet && tag === 258n)) throw new Error(`unsupported CBOR tag ${tag}`);
      return { tag: Number(tag), value: readItem(r, depth + 1, false, witnessSet) };
    }
    default:
      if (ib === 0xf4) return false;
      if (ib === 0xf5) return true;
      if (ib === 0xf6) return null;
      throw new Error(`unsupported CBOR initial byte 0x${ib.toString(16).padStart(2, '0')}`);
  }
}

/** Decode exactly one CBOR item; trailing bytes are an error. */
export function decodeCbor(buf: Uint8Array, witnessSet = false): CborValue {
  const r = new Reader(buf);
  const value = readItem(r, 0, true, witnessSet);
  if (!r.done) throw new Error(`${buf.length - r.pos} trailing bytes after the CBOR item`);
  return value;
}
