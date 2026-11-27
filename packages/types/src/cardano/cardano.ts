import type { ICoreWallet } from '../wallet/wallet.js';

// Cardano uses the MPC relay: a deposit is one native-ADA payment to the reserve, payload hash in tx metadata. Identity is
// the blake2b-224 payment-key hash (key-hash addresses only); withdraw scheme 7 is CIP-30 `signData` over `0x<hash>`.

/** CIP-30 `DataSignature`: both fields are hex CBOR. */
export interface CardanoDataSignature {
  /** COSE_Sign1 CBOR. */
  signature: string;
  /** COSE_Key CBOR. */
  key: string;
}

/** Scheme-7 fields a withdraw-auth carries beside its 64-byte signature. */
export interface CardanoSignDataWire {
  coseSign1: `0x${string}`;
  coseKey: `0x${string}`;
}

/** CIP-20 metadata: the payload hash as 64 bare lowercase hex characters. */
export interface CardanoDepositMetadata {
  '674': { msg: [string] };
}

/** `to` is the reserve, `value` lovelace, `data` the CIP-20 memo (payload hash, 64 bare hex characters). */
export type CardanoRawTransaction = {
  from: string;
  to: string;
  value: bigint;
  data: string;
  token: string;
};

export type CardanoReturnType<Raw extends boolean> = Raw extends true
  ? CardanoRawTransaction
  : Raw extends false
    ? string
    : CardanoRawTransaction | string;

/** Subset of a Koios `tx_info` entry the sdk reads. */
export type CardanoRawTransactionReceipt = {
  tx_hash: string;
  block_height?: number | null;
  num_confirmations?: number | null;
};

/** In lovelace. */
export type CardanoGasEstimate = {
  fee: bigint;
};

export interface ICardanoWalletProvider extends ICoreWallet {
  readonly chainType: 'CARDANO';
  /** Bech32 key-hash payment address; its key hash is the withdraw-auth identity. */
  getWalletAddress: () => Promise<string>;
  /** CIP-30 `signTx(tx, false)` over hex CBOR with an empty witness set; returns only the witness set (hex CBOR). */
  signTransaction: (unsignedTx: string) => Promise<string>;
  /** A wallet declining before broadcast must reject with CIP-30 `{ code: 1, info: string }`; any other rejection
   * is treated as a possible broadcast. */
  submitTransaction: (signedTx: string) => Promise<string>;
  /** CIP-30 `signData(address, payload)` result, returned unchanged. */
  signData: (payload: `0x${string}`) => Promise<CardanoDataSignature>;
}
