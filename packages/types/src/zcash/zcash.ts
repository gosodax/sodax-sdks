import type { ICoreWallet } from '../wallet/wallet.js';

// Transparent native ZEC only, via the MPC relay: a deposit pays a per-payload t-address the relay later sweeps.
// Withdraw identity is the hash160 of the compressed pubkey (what the `t1…` address encodes); scheme 6 signing.

export interface ZcashTransparentInput {
  /** RPC display (big-endian) hex. */
  txid: string;
  vout: number;
  /** Zatoshis. */
  value: bigint;
  /** Hex. */
  scriptPubKey: string;
}

export interface ZcashTransparentOutput {
  value: bigint;
  /** Hex. */
  scriptPubKey: string;
}

/** v5 transaction; each input carries its spent value and script, which ZIP-244 signature digests need. */
export interface ZcashUnsignedTransaction {
  consensusBranchId: number;
  lockTime: number;
  expiryHeight: number;
  inputs: ZcashTransparentInput[];
  outputs: ZcashTransparentOutput[];
}

/** `to` is the relay-derived deposit address, `value` zatoshis, `data` the hub payload hash it commits to. */
export type ZcashRawTransaction = {
  from: string;
  to: string;
  value: bigint;
  data: string;
  token: string;
};

export type ZcashReturnType<Raw extends boolean> = Raw extends true
  ? ZcashRawTransaction
  : Raw extends false
    ? string
    : ZcashRawTransaction | string;

/** Subset of a verbose `getrawtransaction` result the sdk reads. */
export type ZcashRawTransactionReceipt = {
  txid: string;
  confirmations?: number;
  height?: number;
  blockhash?: string;
  vout?: { n: number; valueZat?: number | string; scriptPubKey?: { hex?: string } }[];
};

/** ZIP-317 fee, in zatoshis. */
export type ZcashGasEstimate = {
  fee: bigint;
};

export interface ZcashTransferParams {
  to: string;
  /** Zatoshis. */
  amount: bigint;
}

export interface IZcashWalletProvider extends ICoreWallet {
  readonly chainType: 'ZCASH';
  /** Transparent `t1…` address. */
  getWalletAddress: () => Promise<string>;
  /** Returns signed tx hex. A wallet that cannot sign raw transactions omits this and implements {@link sendTransfer}. */
  signTransaction?: (tx: ZcashUnsignedTransaction) => Promise<string>;
  /** The wallet picks inputs, change and output order, and broadcasts; resolves to the txid. */
  sendTransfer?: (params: ZcashTransferParams) => Promise<string>;
  /** `zcash-cli signmessage`-style over the text `0x<hash>`; returns the 65-byte compact sig (`header ‖ r ‖ s`). */
  signMessage: (hash: `0x${string}`) => Promise<`0x${string}`>;
}
