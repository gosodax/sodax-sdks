import type { ICoreWallet } from '../wallet/wallet.js';

/**
 * XRPL types for the MPC (memo-mode) deposit flow. XRPL does NOT ride the intent relay — deposits
 * are Payments to the shared MPC reserve carrying a 32-byte payload-hash memo, picked up by the
 * NEAR chain-signatures relay. See `MpcRelayApiService` in the sdk package.
 *
 * Withdrawals use auth scheme 3, which differs from Tron's scheme 1 in two ways that are easy to
 * get wrong:
 *   - the signature is a RAW ed25519 signature over the 32-byte message hash — no prefix, no
 *     envelope, unlike Tron's TIP-191 wrapping;
 *   - the identity is NOT the public key. `sender` is the 20-byte AccountID
 *     (`ripemd160(sha256(pubkey))` over the FULL 33-byte `0xED`-prefixed key), and the 33-byte
 *     key rides alongside as `publicKey`. The contract derives the former from the latter and
 *     compares, so the two are not interchangeable.
 */

/** Amount on XRPL: drops for native XRP, or an issued-currency (IOU) amount object. */
export type XrpAmount =
  | string
  | {
      currency: string;
      issuer: string;
      value: string;
    };

/** An unsigned XRPL Payment, as handed to a wallet for signing. */
export interface XrpUnsignedTransaction {
  TransactionType: 'Payment';
  Account: string;
  Destination: string;
  Amount: XrpAmount;
  /** Memo carrying the payload hash — what the relay matches the deposit on. */
  Memos?: { Memo: { MemoData: string } }[];
  Fee?: string;
  Sequence?: number;
  LastLedgerSequence?: number;
  SigningPubKey?: string;
  [field: string]: unknown;
}

/** A signed XRPL transaction blob ready to submit. */
export interface XrpSignedTransaction {
  /** Hex-encoded signed transaction blob (`tx_blob`). */
  tx_blob: string;
  /** Transaction hash, when the signer computed it. */
  hash?: string;
}

/**
 * Structural raw-tx shape shared with the other spoke chains (see `RawTxReturnType`). `to` is the
 * MPC reserve the funds go to and `data` the memo to tag the Payment with, for both native XRP and
 * an IOU — `token` distinguishes them (the zero sentinel for native XRP), since an IOU Payment
 * carries a currency/issuer amount object rather than a drops string.
 */
export type XrpRawTransaction = {
  from: string;
  to: string;
  value: bigint;
  data: string;
  token: string;
};

export type XrpReturnType<Raw extends boolean> = Raw extends true
  ? XrpRawTransaction
  : Raw extends false
    ? string
    : XrpRawTransaction | string;

/** rippled `tx` response (the fields the relay/sdk actually read). */
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
  /** Sign an unsigned XRPL Payment. The sdk builds the memo transfer; the wallet holds the key. */
  signTransaction: (tx: XrpUnsignedTransaction) => Promise<XrpSignedTransaction>;
  /**
   * Sign the 32-byte withdrawal-auth message hash (scheme 3) as a RAW ed25519 signature — no
   * prefix and no envelope, which is what GemWallet's `signMessage(hexHash, isHex)` produces.
   * Returns the 64-byte signature hex.
   */
  signMessage: (hash: `0x${string}`) => Promise<`0x${string}`>;
  /**
   * The signer's 33-byte `0xED`-prefixed ed25519 public key. Scheme 3 cannot recover the identity
   * from the signature the way secp256k1 does, so the key must be submitted with the withdrawal
   * for the contract to derive the AccountID and check it against `sender`.
   */
  getPublicKey: () => Promise<`0x${string}`>;
  waitForTransactionReceipt: (txHash: string) => Promise<XrpRawTransactionReceipt>;
  /** Broadcast an already-signed transaction via a rippled node. Returns the tx hash. */
  sendTransaction?: (signedTx: XrpSignedTransaction) => Promise<string>;
}
