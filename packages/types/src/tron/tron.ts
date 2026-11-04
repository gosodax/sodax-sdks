import type { MpcWithdrawMessage, MpcWithdrawScheme } from '../chains/chains.js';
import type { Hex } from '../shared/shared.js';
import type { ICoreWallet } from '../wallet/wallet.js';

/**
 * Tron types for the MPC memo-mode deposit flow: transfers to the shared reserve carrying a 32-byte
 * payload-hash memo. See `MpcRelayApiService` in the sdk package.
 */

/** An unsigned Tron transaction as returned by TronGrid `createtransaction` / `triggersmartcontract`. */
export interface TronUnsignedTransaction {
  /** sha256 of `raw_data_hex` — the digest Tron actually signs. */
  txID: string;
  /** Hex protobuf of the transaction body (memo already spliced in for memo-mode deposits). */
  raw_data_hex: string;
  /** Decoded body, when the node returns it. Opaque here. */
  raw_data?: unknown;
  visible?: boolean;
}

/** A Tron transaction carrying its signature(s) (`r||s||v` hex), ready to broadcast. */
export interface TronSignedTransaction extends TronUnsignedTransaction {
  signature: string[];
}

/** The decoded transaction body a node returns beside `raw_data_hex`. A browser wallet signs from it. */
export type TronRawData = {
  contract: unknown[];
  /** Milliseconds since epoch; the node drops the transaction after it. */
  expiration: number;
  ref_block_bytes?: string;
  ref_block_hash?: string;
  timestamp?: number;
  fee_limit?: number;
  data?: string;
};

/**
 * Raw deposit: the node-built transfer to the MPC reserve with the memo already spliced in, in the
 * {@link TronUnsignedTransaction} shape. `raw_data` matches `raw_data_hex`, since a browser wallet checks
 * one against the other. Sign and broadcast it before `raw_data.expiration`, then settle it.
 */
export type TronRawTransaction = {
  txID: string;
  raw_data_hex: string;
  raw_data: TronRawData;
  visible?: boolean;
};

/**
 * Raw withdraw-auth: no Tron transaction exists. Sign `digest` with {@link ITronWalletProvider.signMessage},
 * then submit `{ message, signature, scheme }` to the MPC relay, which returns the withdrawal's trackingId.
 */
export type TronRawWithdraw = {
  message: MpcWithdrawMessage;
  digest: Hex;
  scheme: MpcWithdrawScheme;
};

export type TronReturnType<Raw extends boolean> = Raw extends true
  ? TronRawTransaction | TronRawWithdraw
  : Raw extends false
    ? string
    : TronRawTransaction | TronRawWithdraw | string;

/** What a Tron deposit returns: the unsigned transfer in raw mode, else its tx id. */
export type TronDepositReturnType<Raw extends boolean> = Raw extends true
  ? TronRawTransaction
  : Raw extends false
    ? string
    : TronRawTransaction | string;

/** What a Tron withdraw-auth (`sendMessage`) returns: the unsigned message in raw mode, else its trackingId. */
export type TronSendMessageReturnType<Raw extends boolean> = Raw extends true
  ? TronRawWithdraw
  : Raw extends false
    ? string
    : TronRawWithdraw | string;

/** TronGrid `gettransactioninfobyid` response (the fields the relay/sdk actually read). */
export type TronRawTransactionReceipt = {
  id: string; // transaction id (hash), hex without 0x
  blockNumber?: number;
  blockTimeStamp?: number;
  fee?: number;
  receipt?: {
    result?: string; // 'SUCCESS' | 'REVERT' | ... ; absent for plain TRX transfers
    energy_usage_total?: number;
    net_usage?: number;
    net_fee?: number;
  };
  contractResult?: string[];
};

export interface ITronWalletProvider extends ICoreWallet {
  readonly chainType: 'TRON';
  /** Sign an unsigned transaction: signs `txID` and attaches `signature`. */
  signTransaction: (tx: TronUnsignedTransaction) => Promise<TronSignedTransaction>;
  /**
   * Sign a withdrawal-auth digest with `signMessageV2` (scheme 1), which signs the hash's hex text
   * rather than its raw bytes. Returns the 65-byte `r‖s‖v` hex.
   */
  signMessage: (hash: `0x${string}`) => Promise<`0x${string}`>;
  waitForTransactionReceipt: (txHash: string) => Promise<TronRawTransactionReceipt>;
  /** Broadcast an already-signed transaction via a Tron node. Returns the tx id. */
  sendTransaction?: (signedTx: TronSignedTransaction) => Promise<string>;
  /** Sign and broadcast an unsigned `TronRawTransaction` (e.g. from the Swaps API). Returns the tx id. */
  signAndSendTransaction?: (params: TronRawTransaction) => Promise<string>;
}
