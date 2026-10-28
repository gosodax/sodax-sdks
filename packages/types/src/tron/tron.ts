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

/**
 * Structural raw-tx shape shared with the other spoke chains. `to` is the MPC reserve and `data` the
 * memo; `token` distinguishes a TRC-20 `transfer` call from a native value transfer.
 */
export type TronRawTransaction = {
  from: string;
  to: string;
  value: bigint;
  data: string;
  token: string;
};

export type TronReturnType<Raw extends boolean> = Raw extends true
  ? TronRawTransaction
  : Raw extends false
    ? string
    : TronRawTransaction | string;

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
}
