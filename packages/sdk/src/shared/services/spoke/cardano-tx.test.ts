import { bytesToHex, hexToBytes } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  assembleCardanoTx,
  balanceCardanoDeposit,
  buildCardanoDeposit,
  cardanoDepositAuxiliaryData,
  cardanoHash,
  cardanoMinFee,
  cardanoMinUtxo,
  cardanoTxHash,
  encodeCardanoDepositBody,
  encodeCardanoTxOutput,
  type CardanoProtocolParams,
  type CardanoUtxo,
} from './cardano-tx.js';
import { CARDANO_DEPOSIT_TX, CARDANO_MEMO_DEPOSIT } from './cardano-test-vectors.js';

const V = CARDANO_DEPOSIT_TX;
const reserve = hexToBytes(V.reserveAddressHex);
const change = hexToBytes(V.changeAddressHex);
const memo = CARDANO_MEMO_DEPOSIT.payloadHash;
const params: CardanoProtocolParams = { ...V.params };
const utxo = (lovelace: bigint, n = 0): CardanoUtxo => ({
  txHash: n.toString(16).padStart(64, 'a'),
  index: n,
  lovelace,
});

const build = (utxos: CardanoUtxo[], amount: bigint = V.amount) =>
  buildCardanoDeposit({
    utxos,
    reserveAddress: reserve,
    changeAddress: change,
    amount,
    memoHex: memo,
    params,
    ttlSlot: V.ttlSlot,
  });

describe('cardano memo deposit — relay golden vector', () => {
  const built = build([...V.inputs]);

  it('encodes the memo metadata and its hash exactly as the relay does', () => {
    expect(bytesToHex(cardanoDepositAuxiliaryData(memo))).toBe(V.auxiliaryDataHex);
    expect(bytesToHex(cardanoHash(cardanoDepositAuxiliaryData(memo)))).toBe(V.auxiliaryDataHashHex);
  });

  it('builds the identical transaction body, byte for byte', () => {
    expect(bytesToHex(built.bodyCbor)).toBe(V.bodyHex);
  });

  it('derives the relay tx id, the digest the wallet signs and the hash the deposit is keyed on', () => {
    expect(bytesToHex(built.txId)).toBe(V.txIdHex);
    expect(cardanoTxHash(built)).toBe(V.txIdHex.slice(2));
  });

  it('prices the fee at the exact minimum the relay computed, and pays the reserve at output 0', () => {
    expect(built.body.fee).toBe(V.fee);
    expect(built.body.outputs[0]).toEqual({ address: reserve, lovelace: V.amount });
    expect(built.body.outputs[1]).toEqual({ address: change, lovelace: 10_000_000n - V.amount - V.fee });
  });

  it('assembles the transaction a wallet returns a witness for, to the relay signed bytes', () => {
    const signed = hexToBytes(V.signedTxHex);
    const bodyEnd = 1 + built.bodyCbor.length;
    // `a1 00 d9 0102 81 82 5820 <vkey> 5840 <sig>`: the 107-byte witness set the relay vector carries.
    const witnessSet = signed.slice(bodyEnd, bodyEnd + 107);

    expect(bytesToHex(assembleCardanoTx(built.bodyCbor, witnessSet, built.auxiliaryData))).toBe(V.signedTxHex);
  });

  it('prices a fee that also covers a wallet witness set without the set tag', () => {
    const signed = hexToBytes(V.signedTxHex);
    const sizedWithoutTag = signed.length - 3;

    expect(built.body.fee).toBeGreaterThanOrEqual(cardanoMinFee(sizedWithoutTag, params));
  });
});

describe('cardano deposit input selection', () => {
  it('spends the largest UTXO first and adds more only while the first cannot cover the deposit', () => {
    const built = build([utxo(1_000_000n, 1), utxo(5_000_000n, 2), utxo(3_000_000n, 3)], 6_000_000n);

    expect(built.body.inputs.map(i => i.lovelace)).toEqual([5_000_000n, 3_000_000n]);
  });

  it('uses a single input when it covers the payment, the fee and a change output', () => {
    expect(build([utxo(1_000_000n, 1), utxo(20_000_000n, 2)], 5_000_000n).body.inputs).toHaveLength(1);
  });

  it('adds another input rather than leave a change output below min-UTXO', () => {
    // 2.6 ADA for a 2.5 ADA deposit leaves about 0.1 ADA, which a change output cannot hold.
    const tight = build([utxo(2_600_000n, 1), utxo(2_000_000n, 2)], V.amount);

    expect(tight.body.inputs).toHaveLength(2);
    const changeOutput = tight.body.outputs[1];
    if (!changeOutput) throw new Error('expected a change output');
    expect(changeOutput.lovelace).toBeGreaterThanOrEqual(cardanoMinUtxo(changeOutput, params.coinsPerUtxoByte));
  });

  it('refuses when the funds cannot cover the deposit, the fee and a change output', () => {
    expect(() => build([utxo(2_000_000n, 1)], V.amount)).toThrow(/insufficient pure-ADA funds/);
    expect(() => build([], V.amount)).toThrow(/0 lovelace in 0 UTXOs/);
  });

  it('refuses a non-positive amount', () => {
    expect(() => build([utxo(10_000_000n)], 0n)).toThrow(/must be positive/);
  });

  it('refuses a transaction above the ledger size limit', () => {
    const many = Array.from({ length: 40 }, (_, n) => utxo(500_000n, n));
    expect(() =>
      buildCardanoDeposit({
        utxos: many,
        reserveAddress: reserve,
        changeAddress: change,
        amount: 15_000_000n,
        memoHex: memo,
        params: { ...params, maxTxSize: 1_000 },
        ttlSlot: V.ttlSlot,
      }),
    ).toThrow(/above the 1000-byte transaction limit/);
  });

  it('returns null from the balancer, rather than throwing, when the inputs fall short', () => {
    const aux = cardanoDepositAuxiliaryData(memo);
    expect(
      balanceCardanoDeposit({
        inputs: [utxo(1_000_000n)],
        reserve: { address: reserve, lovelace: V.amount },
        changeAddress: change,
        auxiliaryData: aux,
        params,
        ttlSlot: V.ttlSlot,
      }),
    ).toBeNull();
  });
});

describe('cardano CBOR encoding', () => {
  const lovelaceHead = (lovelace: bigint): string =>
    bytesToHex(encodeCardanoTxOutput({ address: new Uint8Array(0), lovelace })).slice(2 + 4);

  it.each([
    [23n, '17'],
    [24n, '1818'],
    [255n, '18ff'],
    [256n, '190100'],
    [65_535n, '19ffff'],
    [65_536n, '1a00010000'],
    [4_294_967_295n, '1affffffff'],
    [4_294_967_296n, '1b0000000100000000'],
  ])('writes lovelace %s in its shortest canonical form', (lovelace, expected) => {
    expect(lovelaceHead(lovelace)).toBe(expected);
  });

  it('refuses a value outside u64', () => {
    expect(() => encodeCardanoTxOutput({ address: new Uint8Array(0), lovelace: 1n << 64n })).toThrow(
      /outside 0\.\.2\^64-1/,
    );
    expect(() => encodeCardanoTxOutput({ address: new Uint8Array(0), lovelace: -1n })).toThrow(/outside/);
  });

  it('refuses a malformed memo and a malformed input reference', () => {
    expect(() => cardanoDepositAuxiliaryData('0x1234')).toThrow(/32 bytes of hex/);
    const body = build([...V.inputs]).body;
    const encode = (input: CardanoUtxo) => encodeCardanoDepositBody({ ...body, inputs: [input] });
    expect(() => encode({ ...utxo(1n), txHash: 'AB'.repeat(32) })).toThrow(/64 lowercase hex/);
    expect(() => encode({ ...utxo(1n), index: 65_536 })).toThrow(/0\.\.65535/);
    expect(() => encodeCardanoDepositBody({ ...body, auxiliaryDataHash: new Uint8Array(31) })).toThrow(/32 bytes/);
  });
});
