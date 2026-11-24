import type { ICoreWallet } from '../wallet/wallet.js';

/**
 * Zcash types for the MPC (address-mode) deposit flow. Transparent (t-address) native ZEC only —
 * secp256k1, UTXO, no shielded pool. Zcash does NOT ride the intent relay: a deposit pays a t-address
 * the relay derives for that one payload, which it later sweeps into its reserve.
 *
 * A Zcash account is addressed by its transparent `t1…` address; its withdraw-auth identity is the
 * 20-byte hash160 of the compressed public key, which that address encodes. Withdrawals use scheme 6,
 * a Bitcoin-style `signmessage` over the hex text of the message hash.
 */

/** A transparent output being spent: its outpoint, and the value and script it carries. */
export interface ZcashTransparentInput {
  /** Previous transaction id, in RPC display (big-endian) hex. */
  txid: string;
  vout: number;
  /** Zatoshis the output holds. */
  value: bigint;
  /** The output's locking script, hex. */
  scriptPubKey: string;
}

export interface ZcashTransparentOutput {
  value: bigint;
  /** Locking script, hex. */
  scriptPubKey: string;
}

/**
 * An unsigned transparent-only Zcash v5 transaction, with each input's spent value and script — what a
 * wallet needs to compute the ZIP-244 signature digest.
 */
export interface ZcashUnsignedTransaction {
  consensusBranchId: number;
  lockTime: number;
  expiryHeight: number;
  inputs: ZcashTransparentInput[];
  outputs: ZcashTransparentOutput[];
}

/**
 * Structural raw-tx shape shared with the other spoke chains (see `RawTxReturnType`). `to` is the deposit
 * address the relay derived, `value` the zatoshis paid to it, and `data` the hub payload hash it commits to.
 */
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

/** A `getrawtransaction` (verbose) result — the fields the sdk reads. */
export type ZcashRawTransactionReceipt = {
  txid: string;
  confirmations?: number;
  height?: number;
  blockhash?: string;
  vout?: { n: number; valueZat?: number | string; scriptPubKey?: { hex?: string } }[];
};

/** The ZIP-317 fee a deposit transaction pays, in zatoshis. */
export type ZcashGasEstimate = {
  fee: bigint;
};

/** A payment a wallet builds and broadcasts itself. */
export interface ZcashTransferParams {
  /** Transparent `t1…` recipient. */
  to: string;
  /** Zatoshis to pay. */
  amount: bigint;
}

export interface IZcashWalletProvider extends ICoreWallet {
  readonly chainType: 'ZCASH';
  /** The account's transparent `t1…` address. */
  getWalletAddress: () => Promise<string>;
  /**
   * Sign every input of a transparent v5 transaction the sdk built; returns the signed transaction as hex.
   * A wallet that cannot sign raw transactions omits this and implements {@link sendTransfer}.
   */
  signTransaction?: (tx: ZcashUnsignedTransaction) => Promise<string>;
  /**
   * Pay `amount` zatoshis to `to` from the account's transparent funds, letting the wallet pick the inputs,
   * change and output order, and broadcast it. Resolves to the txid.
   */
  sendTransfer?: (params: ZcashTransferParams) => Promise<string>;
  /**
   * Bitcoin-style `signmessage` over the text `0x<hash>` (scheme 6) — what `zcash-cli signmessage` does.
   * Returns the 65-byte compact signature (`header ‖ r ‖ s`) as `0x` hex.
   */
  signMessage: (hash: `0x${string}`) => Promise<`0x${string}`>;
}
