import type { MpcWithdrawMessage, MpcWithdrawScheme } from '../chains/chains.js';
import type { Hex } from '../shared/shared.js';
import type { ICoreWallet } from '../wallet/wallet.js';


/** As returned by TronGrid `createtransaction` / `triggersmartcontract`. */
export interface TronUnsignedTransaction {
  /** sha256 of `raw_data_hex` — the digest Tron actually signs. */
  txID: string;
  /** Hex protobuf body (memo already spliced in for memo-mode deposits). */
  raw_data_hex: string;
  raw_data?: unknown;
  visible?: boolean;
}

/** Signatures are `r||s||v` hex. */
export interface TronSignedTransaction extends TronUnsignedTransaction {
  signature: string[];
}

/** Decoded body returned beside `raw_data_hex`; a browser wallet signs from it. */
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
 * Node-built transfer to the MPC reserve, memo spliced in. `raw_data` must match `raw_data_hex` (browser wallets
 * check one against the other); sign and broadcast before `raw_data.expiration`, then settle it.
 */
export type TronRawTransaction = {
  txID: string;
  raw_data_hex: string;
  raw_data: TronRawData;
  visible?: boolean;
};

/** No Tron transaction exists: sign `digest` with {@link ITronWalletProvider.signMessage}, then submit to the MPC relay. */
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

export type TronDepositReturnType<Raw extends boolean> = Raw extends true
  ? TronRawTransaction
  : Raw extends false
    ? string
    : TronRawTransaction | string;

/** Non-raw result is the withdrawal's trackingId. */
export type TronSendMessageReturnType<Raw extends boolean> = Raw extends true
  ? TronRawWithdraw
  : Raw extends false
    ? string
    : TronRawWithdraw | string;

/** Subset of the TronGrid `gettransactioninfobyid` response the sdk reads. */
export type TronRawTransactionReceipt = {
  id: string; // hex without 0x
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
  /** Signs `txID` and attaches `signature`. */
  signTransaction: (tx: TronUnsignedTransaction) => Promise<TronSignedTransaction>;
  /** `signMessageV2` (scheme 1) over the hash's hex text, not its raw bytes; returns the 65-byte `r‖s‖v` hex. */
  signMessage: (hash: `0x${string}`) => Promise<`0x${string}`>;
  waitForTransactionReceipt: (txHash: string) => Promise<TronRawTransactionReceipt>;
  /** Returns the tx id. */
  sendTransaction?: (signedTx: TronSignedTransaction) => Promise<string>;
  /** For an unsigned `TronRawTransaction` (e.g. from the Swaps API); returns the tx id. */
  signAndSendTransaction?: (params: TronRawTransaction) => Promise<string>;
}
