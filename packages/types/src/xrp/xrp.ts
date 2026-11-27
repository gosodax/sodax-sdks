import type { MpcWithdrawMessage, MpcWithdrawScheme } from '../chains/chains.js';
import type { Hex } from '../shared/shared.js';
import type { ICoreWallet } from '../wallet/wallet.js';

// XRPL uses the MPC relay, not the intent relay: deposits are Payments to the MPC reserve with a 32-byte payload-hash memo.
// Withdraw scheme 3: RAW ed25519 sig (no TIP-191 envelope); `sender` is the AccountID derived from the 33-byte `0xED` key.

/** Amount on XRPL: drops for native XRP, or an issued-currency (IOU) amount object. */
export type XrpAmount =
  | string
  | {
      currency: string;
      issuer: string;
      value: string;
    };

export interface XrpUnsignedTransaction {
  TransactionType: 'Payment';
  Account: string;
  Destination: string;
  Amount: XrpAmount;
  /** Payload hash the relay matches the deposit on. */
  Memos?: { Memo: { MemoData: string } }[];
  Fee?: string;
  Sequence?: number;
  LastLedgerSequence?: number;
  SigningPubKey?: string;
  [field: string]: unknown;
}

/** Fee, Sequence and LastLedgerSequence are left to the wallet, as for a Payment. */
export interface XrpUnsignedTrustSet {
  TransactionType: 'TrustSet';
  Account: string;
  LimitAmount: {
    currency: string;
    issuer: string;
    value: string;
  };
  Flags?: number;
  Fee?: string;
  Sequence?: number;
  LastLedgerSequence?: number;
  SigningPubKey?: string;
  [field: string]: unknown;
}

/** Identifies an XRP Ledger payment whose wallet reply did not include a hash. */
export type XrpPaymentRecovery = {
  readonly kind: 'xrp-payment';
  readonly account: string;
  readonly destination: string;
  readonly memo?: string;
  readonly amount: XrpAmount;
  readonly attemptedAtMs: number;
};

export interface XrpSignedTransaction {
  /** Hex-encoded. */
  tx_blob: string;
  hash?: string;
}

/**
 * `to` is the MPC reserve, `data` the memo; `token` is the zero sentinel for native XRP, else an IOU.
 * `transaction` is the built Payment: sign and submit it, then notify the relay of its hash.
 */
export type XrpRawTransaction = {
  from: string;
  to: string;
  value: bigint;
  data: string;
  token: string;
  transaction: XrpUnsignedTransaction;
};

/** No XRPL transaction exists: sign `digest` with {@link IXrpWalletProvider.signMessage}, then submit it with the `0xED` public key. */
export type XrpRawWithdraw = {
  message: MpcWithdrawMessage;
  digest: Hex;
  scheme: MpcWithdrawScheme;
};

export type XrpReturnType<Raw extends boolean> = Raw extends true
  ? XrpRawTransaction | XrpRawWithdraw
  : Raw extends false
    ? string
    : XrpRawTransaction | XrpRawWithdraw | string;

export type XrpDepositReturnType<Raw extends boolean> = Raw extends true
  ? XrpRawTransaction
  : Raw extends false
    ? string
    : XrpRawTransaction | string;

/** Non-raw result is the withdrawal's trackingId. */
export type XrpSendMessageReturnType<Raw extends boolean> = Raw extends true
  ? XrpRawWithdraw
  : Raw extends false
    ? string
    : XrpRawWithdraw | string;

/** Subset of the rippled `tx` response the sdk reads. */
export type XrpRawTransactionReceipt = {
  hash: string;
  ledger_index?: number;
  validated?: boolean;
  meta?: {
    TransactionResult?: string; // 'tesSUCCESS' | 'tec...' | ...
    delivered_amount?: XrpAmount;
  };
};

export interface IXrpWalletProvider extends ICoreWallet {
  readonly chainType: 'XRP';
  /** A submitting provider returns the hash with an empty blob; on an ambiguous submit without a hash, throw an
   * IndeterminateOutcomeError carrying an XrpPaymentRecovery handle. */
  signTransaction: (tx: XrpUnsignedTransaction) => Promise<XrpSignedTransaction>;
  /** Without it the sdk refuses trustline requests. A submitting provider returns the hash with an empty blob. */
  signTrustSet?: (tx: XrpUnsignedTrustSet) => Promise<XrpSignedTransaction>;
  /** RAW ed25519 signature (64 bytes) over the 32-byte hash, no prefix or envelope, as GemWallet's `signMessage(hexHash, isHex)`. */
  signMessage: (hash: `0x${string}`) => Promise<`0x${string}`>;
  /** 33-byte `0xED`-prefixed ed25519 key; ed25519 cannot recover the signer, so it is submitted for the contract to check `sender`. */
  getPublicKey: () => Promise<`0x${string}`>;
  waitForTransactionReceipt: (txHash: string) => Promise<XrpRawTransactionReceipt>;
  /** Broadcasts via a rippled node; returns the tx hash. */
  sendTransaction?: (signedTx: XrpSignedTransaction) => Promise<string>;
}
