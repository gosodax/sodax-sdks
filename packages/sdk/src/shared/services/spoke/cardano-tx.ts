/**
 * Cardano memo-deposit transaction codec: one native-ADA payment to the MPC reserve at output 0, change back
 * to the sender, and the CIP-20 label-674 memo as auxiliary data. A CIP-30 wallet signs and submits but does
 * not build transactions, so the sdk builds the body itself; the bytes are pinned to the relay's contract
 * vectors (`cardano-test-vectors.ts`).
 *
 * Encoding rules:
 *  - body   = map {0: tag258 [inputs…], 1: [outputs…], 2: fee, 3: ttl, 7: auxiliary data hash}, keys ascending;
 *  - input  = [tx_hash bstr32, index uint], kept in selection order;
 *  - output = legacy array [address bstr, lovelace uint] (pure ADA: no native token ever moves);
 *  - tx     = [body, witness set, true, auxiliary data].
 */
import { blake2b } from '@noble/hashes/blake2b';
import { bytesToHex, hexToBytes } from 'viem';

/** Validity window of a deposit: 2 hours, so a slow wallet or a congested network still lands it. */
export const CARDANO_TTL_SECONDS = 7200;

/** Per-entry overhead the Babbage min-UTXO rule adds to the encoded output length. */
const MIN_UTXO_OVERHEAD_BYTES = 160n;
const U64_MAX = (1n << 64n) - 1n;
const SET_TAG = 258n;
const MAX_FEE_ROUNDS = 8;

/** A spendable pure-ADA output. */
export type CardanoUtxo = {
  /** 32-byte tx id, 64 lowercase hex characters, no `0x`. */
  txHash: string;
  index: number;
  lovelace: bigint;
};

/** One body output: raw Shelley address bytes (29 or 57) and the lovelace it holds. */
export type CardanoTxOutput = {
  address: Uint8Array;
  lovelace: bigint;
};

/** Ledger parameters a deposit is priced and bounded by. */
export type CardanoProtocolParams = {
  minFeeA: bigint;
  minFeeB: bigint;
  coinsPerUtxoByte: bigint;
  maxTxSize: number;
};

export type CardanoDepositBody = {
  inputs: CardanoUtxo[];
  outputs: CardanoTxOutput[];
  fee: bigint;
  ttlSlot: bigint;
  auxiliaryDataHash: Uint8Array;
};

export type BuiltCardanoDeposit = {
  body: CardanoDepositBody;
  bodyCbor: Uint8Array;
  /** Hex CBOR of the memo metadata; its hash is in the body and it travels in the transaction's fourth element. */
  auxiliaryData: Uint8Array;
  /** blake2b-256 of the body: the tx hash. */
  txId: Uint8Array;
};

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** CBOR head: major type in the top 3 bits, the argument in its shortest form. */
function head(major: number, value: bigint): Uint8Array {
  if (value < 0n || value > U64_MAX) throw new Error(`CBOR argument ${value} is outside 0..2^64-1`);
  const m = major << 5;
  if (value < 24n) return Uint8Array.of(m | Number(value));
  if (value <= 0xffn) return Uint8Array.of(m | 24, Number(value));
  if (value <= 0xffffn) return Uint8Array.of(m | 25, Number(value >> 8n), Number(value & 0xffn));
  if (value <= 0xffffffffn) {
    return Uint8Array.of(m | 26, ...[24n, 16n, 8n, 0n].map(shift => Number((value >> shift) & 0xffn)));
  }
  return Uint8Array.of(
    m | 27,
    ...[56n, 48n, 40n, 32n, 24n, 16n, 8n, 0n].map(shift => Number((value >> shift) & 0xffn)),
  );
}

const uint = (n: bigint): Uint8Array => head(0, n);
const bytes = (b: Uint8Array): Uint8Array => concat(head(2, BigInt(b.length)), b);
const text = (s: string): Uint8Array => {
  const encoded = new TextEncoder().encode(s);
  return concat(head(3, BigInt(encoded.length)), encoded);
};

/** The auxiliary data of a memo deposit: `{674: {"msg": [<64 hex characters>]}}`. */
export function cardanoDepositAuxiliaryData(memoHex: string): Uint8Array {
  const memo = memoHex.replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(memo))
    throw new Error(`Cardano memo must be 32 bytes of hex, got "${memoHex.slice(0, 80)}"`);
  return concat(head(5, 1n), uint(674n), head(5, 1n), text('msg'), head(4, 1n), text(memo));
}

/** blake2b-256: the hash a body commits its auxiliary data with, and the tx id of a body. */
export function cardanoHash(data: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 32 });
}

/** One output: `[address, lovelace]`. Its encoded length drives the min-UTXO rule. */
export function encodeCardanoTxOutput(output: CardanoTxOutput): Uint8Array {
  return concat(head(4, 2n), bytes(output.address), uint(output.lovelace));
}

/** Serialize a deposit body per the rules in the file header. */
export function encodeCardanoDepositBody(body: CardanoDepositBody): Uint8Array {
  if (body.auxiliaryDataHash.length !== 32) {
    throw new Error(`Cardano auxiliary data hash must be 32 bytes, got ${body.auxiliaryDataHash.length}`);
  }
  const inputs = body.inputs.map(input => {
    if (!/^[0-9a-f]{64}$/.test(input.txHash))
      throw new Error(`Cardano input tx hash must be 64 lowercase hex characters, got "${input.txHash}"`);
    if (!Number.isInteger(input.index) || input.index < 0 || input.index > 0xffff) {
      throw new Error(`Cardano input index must be 0..65535, got ${input.index}`);
    }
    return concat(head(4, 2n), bytes(hexToBytes(`0x${input.txHash}`)), uint(BigInt(input.index)));
  });
  return concat(
    head(5, 5n),
    uint(0n),
    head(6, SET_TAG),
    head(4, BigInt(inputs.length)),
    ...inputs,
    uint(1n),
    head(4, BigInt(body.outputs.length)),
    ...body.outputs.map(encodeCardanoTxOutput),
    uint(2n),
    uint(body.fee),
    uint(3n),
    uint(body.ttlSlot),
    uint(7n),
    bytes(body.auxiliaryDataHash),
  );
}

/** Babbage+ min-UTXO: `(160 + encoded output length) * coinsPerUtxoByte`. */
export function cardanoMinUtxo(output: CardanoTxOutput, coinsPerUtxoByte: bigint): bigint {
  return (MIN_UTXO_OVERHEAD_BYTES + BigInt(encodeCardanoTxOutput(output).length)) * coinsPerUtxoByte;
}

/** `[body, witness set, true, auxiliary data]`: the transaction a wallet signs and the network accepts. */
export function assembleCardanoTx(bodyCbor: Uint8Array, witnessSet: Uint8Array, auxiliaryData: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(0x84), bodyCbor, witnessSet, Uint8Array.of(0xf5), auxiliaryData);
}

/** An empty witness set, as the wallet is handed the unsigned transaction. */
export const EMPTY_WITNESS_SET = Uint8Array.of(0xa0);

/**
 * A witness set with one vkey witness of placeholder bytes, only to size the signed transaction for the fee.
 * It carries the set tag (258) that a wallet may omit, so a real witness is never larger and the fee is never short.
 */
const SIZING_WITNESS_SET = concat(
  Uint8Array.of(0xa1, 0x00, 0xd9, 0x01, 0x02, 0x81, 0x82, 0x58, 0x20),
  new Uint8Array(32),
  Uint8Array.of(0x58, 0x40),
  new Uint8Array(64),
);

/** The minimum fee of a signed transaction of `signedSize` bytes. */
export function cardanoMinFee(signedSize: number, params: Pick<CardanoProtocolParams, 'minFeeA' | 'minFeeB'>): bigint {
  return params.minFeeA * BigInt(signedSize) + params.minFeeB;
}

/**
 * Balance a deposit over exactly `inputs`: the fee fixed point for a one-key spend that carries the memo, sized
 * with a placeholder witness. Returns `null` when `inputs` cannot cover the reserve payment, the fee and a
 * change output at min-UTXO, so the caller adds another input.
 */
export function balanceCardanoDeposit(opts: {
  inputs: CardanoUtxo[];
  reserve: CardanoTxOutput;
  changeAddress: Uint8Array;
  auxiliaryData: Uint8Array;
  params: CardanoProtocolParams;
  ttlSlot: bigint;
}): BuiltCardanoDeposit | null {
  const { inputs, reserve, changeAddress, auxiliaryData, params, ttlSlot } = opts;
  const inputSum = inputs.reduce((sum, utxo) => sum + utxo.lovelace, 0n);
  const auxiliaryDataHash = cardanoHash(auxiliaryData);
  let fee = 0n;
  // The fee only grows, and the body moves by a few bytes when an integer crosses a CBOR width, so it settles quickly.
  for (let round = 0; round < MAX_FEE_ROUNDS; round++) {
    const changeLovelace = inputSum - reserve.lovelace - fee;
    if (changeLovelace <= 0n) return null;
    const change: CardanoTxOutput = { address: changeAddress, lovelace: changeLovelace };
    if (changeLovelace < cardanoMinUtxo(change, params.coinsPerUtxoByte)) return null;
    const body: CardanoDepositBody = { inputs, outputs: [reserve, change], fee, ttlSlot, auxiliaryDataHash };
    const bodyCbor = encodeCardanoDepositBody(body);
    const sized = assembleCardanoTx(bodyCbor, SIZING_WITNESS_SET, auxiliaryData);
    if (sized.length > params.maxTxSize) {
      throw new Error(
        `Cardano deposit would be ${sized.length} bytes, above the ${params.maxTxSize}-byte transaction limit`,
      );
    }
    const need = cardanoMinFee(sized.length, params);
    if (fee >= need) return { body, bodyCbor, auxiliaryData, txId: cardanoHash(bodyCbor) };
    fee = need;
  }
  throw new Error(`Cardano deposit fee did not converge in ${MAX_FEE_ROUNDS} rounds`);
}

/**
 * Build a memo deposit of `amount` lovelace to `reserveAddress`, spending the largest pure-ADA UTXOs first. UTXOs
 * that carry native tokens are never spent: a token moved into the reserve output is never credited and cannot be
 * refunded.
 */
export function buildCardanoDeposit(opts: {
  utxos: CardanoUtxo[];
  reserveAddress: Uint8Array;
  changeAddress: Uint8Array;
  amount: bigint;
  memoHex: string;
  params: CardanoProtocolParams;
  ttlSlot: bigint;
}): BuiltCardanoDeposit {
  const { utxos, reserveAddress, changeAddress, amount, memoHex, params, ttlSlot } = opts;
  if (amount <= 0n) throw new Error(`Cardano deposit amount must be positive, got ${amount} lovelace`);
  const auxiliaryData = cardanoDepositAuxiliaryData(memoHex);
  const reserve: CardanoTxOutput = { address: reserveAddress, lovelace: amount };
  const sorted = [...utxos].sort((a, b) => (b.lovelace > a.lovelace ? 1 : b.lovelace < a.lovelace ? -1 : 0));

  const chosen: CardanoUtxo[] = [];
  for (const utxo of sorted) {
    chosen.push(utxo);
    const built = balanceCardanoDeposit({
      inputs: [...chosen],
      reserve,
      changeAddress,
      auxiliaryData,
      params,
      ttlSlot,
    });
    if (built) return built;
  }
  const available = sorted.reduce((sum, utxo) => sum + utxo.lovelace, 0n);
  throw new Error(
    `insufficient pure-ADA funds for ${amount} lovelace plus the fee and a change output: ${available} lovelace in ${sorted.length} UTXOs (outputs holding native tokens are not spent)`,
  );
}

/** The tx hash of a built deposit, as the relay and explorers write it: 64 lowercase hex characters. */
export function cardanoTxHash(built: Pick<BuiltCardanoDeposit, 'txId'>): string {
  return bytesToHex(built.txId).slice(2);
}
