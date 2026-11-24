import { bytesToHex, hexToBytes } from 'viem';

class CborReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  private byte(): number {
    const value = this.bytes[this.offset++];
    if (value === undefined) throw new Error('Truncated CIP-30 CBOR');
    return value;
  }

  head(): { major: number; value: bigint | null } {
    const head = this.byte();
    const major = head >> 5;
    const info = head & 31;
    if (info < 24) return { major, value: BigInt(info) };
    if (info === 31) return { major, value: null };
    if (info > 27) throw new Error('Invalid CIP-30 CBOR argument');
    let value = 0n;
    for (let i = 0; i < 2 ** (info - 24); i++) value = (value << 8n) | BigInt(this.byte());
    return { major, value };
  }

  take(length: bigint): Uint8Array {
    if (length > BigInt(this.bytes.length - this.offset)) throw new Error('Truncated CIP-30 CBOR');
    const end = this.offset + Number(length);
    const result = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return result;
  }

  endIndefinite(): void {
    if (this.byte() !== 0xff) throw new Error('Invalid CIP-30 CBOR break');
  }

  *entries(count: bigint | null): Generator<void> {
    if (count === null) {
      while (this.bytes[this.offset] !== 0xff) yield;
      this.endIndefinite();
    } else {
      for (let i = 0n; i < count; i++) yield;
    }
  }

  skip(depth = 0): void {
    if (depth > 64) throw new Error('CIP-30 CBOR nesting is too deep');
    const { major, value } = this.head();
    if (major === 2 || major === 3 || major === 4 || major === 5) {
      if ((major === 2 || major === 3) && value !== null) {
        this.take(value);
        return;
      }
      for (const _entry of this.entries(value)) {
        this.skip(depth + 1);
        if (major === 5) this.skip(depth + 1);
      }
    } else if (major === 6) {
      this.skip(depth + 1);
    } else if (value === null) {
      throw new Error('Unexpected CIP-30 CBOR break');
    }
  }
}

function readAddress(reader: CborReader): string {
  const { major, value } = reader.head();
  if (major !== 2 || value === null) throw new Error('Invalid CIP-30 output address');
  return bytesToHex(reader.take(value)).slice(2);
}

function readCoin(reader: CborReader): bigint {
  let head = reader.head();
  if (head.major === 4) {
    const count = head.value;
    if (count !== null && count !== 2n) throw new Error('Invalid CIP-30 multiasset value');
    head = reader.head();
    reader.skip();
    if (count === null) reader.endIndefinite();
  }
  if (head.major !== 0 || head.value === null) throw new Error('Invalid CIP-30 lovelace value');
  return head.value;
}

/** Read the address and lovelace from a CIP-30 UTXO with a legacy or Babbage output. */
export function readCardanoUtxo(hex: string): { address: string; lovelace: bigint } {
  if (!/^[\da-f]+$/i.test(hex) || hex.length % 2 !== 0) throw new Error('Invalid CIP-30 UTXO hex');
  const reader = new CborReader(hexToBytes(`0x${hex}`));
  const utxo = reader.head();
  if (utxo.major !== 4 || (utxo.value !== 2n && utxo.value !== null)) throw new Error('Invalid CIP-30 UTXO');
  reader.skip();
  const output = reader.head();
  if (output.major === 4 && (output.value === null || output.value >= 2n)) {
    return { address: readAddress(reader), lovelace: readCoin(reader) };
  }
  if (output.major !== 5) throw new Error('Invalid CIP-30 output');

  let address: string | undefined;
  let lovelace: bigint | undefined;
  for (const _entry of reader.entries(output.value)) {
    const key = reader.head();
    if (key.major !== 0) throw new Error('Invalid CIP-30 output key');
    if (key.value === 0n) address = readAddress(reader);
    else if (key.value === 1n) lovelace = readCoin(reader);
    else reader.skip();
    if (address !== undefined && lovelace !== undefined) return { address, lovelace };
  }
  throw new Error('CIP-30 output is missing its address or lovelace value');
}
