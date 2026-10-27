/**
 * Test-only builders for Tron `raw_data_hex` bodies, shaped like TronGrid's `createtransaction` /
 * `triggersmartcontract` output: ref block, expiration, one contract, then an optional fee limit.
 */
import { encodeTrc20TransferParams, tronBase58ToHex } from './tron-utils.js';

const varint = (n: bigint): string => {
  let out = '';
  let x = n;
  while (x > 0x7fn) {
    out += ((x & 0x7fn) | 0x80n).toString(16).padStart(2, '0');
    x >>= 7n;
  }
  return out + x.toString(16).padStart(2, '0');
};

export const pbVarint = (field: number, value: bigint): string => varint(BigInt(field << 3)) + varint(value);
export const pbBytes = (field: number, hex: string): string =>
  varint(BigInt((field << 3) | 2)) + varint(BigInt(hex.length / 2)) + hex;

export function tronRawData(contractType: bigint, typeName: string, valueHex: string, feeLimit?: bigint): string {
  const typeUrl = Buffer.from(`type.googleapis.com/protocol.${typeName}`).toString('hex');
  const contract = pbVarint(1, contractType) + pbBytes(2, pbBytes(1, typeUrl) + pbBytes(2, valueHex));
  return pbBytes(1, 'abcd') + pbVarint(8, 1n) + pbBytes(11, contract) + (feeLimit ? pbVarint(18, feeLimit) : '');
}

export const nativeTransferRaw = (owner: string, to: string, amount: bigint): string =>
  tronRawData(
    1n,
    'TransferContract',
    pbBytes(1, tronBase58ToHex(owner)) + pbBytes(2, tronBase58ToHex(to)) + pbVarint(3, amount),
  );

export const trc20TransferRaw = (owner: string, token: string, to: string, amount: bigint, feeLimit = 100_000_000n) =>
  tronRawData(
    31n,
    'TriggerSmartContract',
    pbBytes(1, tronBase58ToHex(owner)) +
      pbBytes(2, tronBase58ToHex(token)) +
      pbBytes(4, `a9059cbb${encodeTrc20TransferParams(to, amount)}`),
    feeLimit,
  );
