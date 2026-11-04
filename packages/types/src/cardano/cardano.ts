import type { ICoreWallet } from '../wallet/wallet.js';

/**
 * Cardano types for the MPC (memo-mode) flow. Cardano does NOT ride the intent relay: a deposit is one
 * native-ADA payment to the shared MPC reserve whose transaction metadata carries the 32-byte payload hash.
 *
 * A Cardano account is identified by the 28-byte blake2b-224 hash of its payment key; the relay's deposit
 * owner, the withdraw sender and the hub-wallet identity are all that hash. Only key-hash payment addresses
 * (enterprise or base) are valid, and only native ADA is deposited.
 *
 * Withdrawals use auth scheme 7: a CIP-30 `signData` over the readable text `0x<message hash>`, submitted with
 * the wallet's COSE_Sign1 and COSE_Key.
 */

/** A CIP-30 `DataSignature`, as `api.signData` returns it: both fields are hex CBOR. */
export interface CardanoDataSignature {
  /** COSE_Sign1 CBOR. */
  signature: string;
  /** COSE_Key CBOR. */
  key: string;
}

/** The scheme-7 fields a withdraw-auth carries beside its 64-byte signature. */
export interface CardanoSignDataWire {
  coseSign1: `0x${string}`;
  coseKey: `0x${string}`;
}

/** The CIP-20 transaction metadata a deposit attaches: the payload hash as 64 bare lowercase hex characters. */
export interface CardanoDepositMetadata {
  '674': { msg: [string] };
}

/**
 * Structural raw-tx shape shared with the other spoke chains (see `RawTxReturnType`). `to` is the reserve,
 * `value` the lovelace paid to it, and `data` the CIP-20 memo (the payload hash, 64 bare hex characters).
 */
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

/** A Koios `tx_info` entry: the fields the sdk reads to tell whether a transaction is in a block. */
export type CardanoRawTransactionReceipt = {
  tx_hash: string;
  block_height?: number | null;
  num_confirmations?: number | null;
};

/** The network fee a deposit transaction pays, in lovelace. */
export type CardanoGasEstimate = {
  fee: bigint;
};

export interface ICardanoWalletProvider extends ICoreWallet {
  readonly chainType: 'CARDANO';
  /** The account's bech32 key-hash payment address: the deposit owner, and whose key hash is the withdraw-auth identity. */
  getWalletAddress: () => Promise<string>;
  /**
   * CIP-30 `signTx(tx, false)` over a full transaction the sdk built (hex CBOR, empty witness set). Returns the
   * wallet's witness set (hex CBOR), which the sdk attaches to the transaction.
   */
  signTransaction: (unsignedTx: string) => Promise<string>;
  /** CIP-30 `submitTx`: broadcasts a signed transaction (hex CBOR) and resolves to its tx hash. */
  submitTransaction: (signedTx: string) => Promise<string>;
  /** CIP-30 `signData(address, payload)` over the withdraw-auth payload (scheme 7), returned unchanged. */
  signData: (payload: `0x${string}`) => Promise<CardanoDataSignature>;
}
