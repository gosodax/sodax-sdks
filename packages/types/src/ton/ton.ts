import type { ICoreWallet } from '../wallet/wallet.js';

/**
 * TON types for the MPC (memo-mode) deposit flow. TON does NOT ride the intent relay — deposits pay
 * the shared MPC reserve carrying a 32-byte payload-hash memo (a binary comment for native TON, the
 * jetton transfer's `forward_payload` for a jetton), picked up by the NEAR chain-signatures relay.
 *
 * A TON account is identified by its 32-byte ed25519 PUBLIC KEY, not its address: a TON address is
 * `hash(StateInit)` and cannot be inverted, so the relay's deposit owner, the withdraw sender and the
 * hub-wallet identity are all the pubkey. The SDK's address for a TON account is therefore that
 * pubkey; the wallet-v4R2 address derived from it is what pays and receives.
 *
 * Withdrawals use auth scheme 5: a TonConnect `signData` over a readable text line embedding the
 * message hash, submitted with the pubkey and the envelope fields the wallet bound into the signature.
 */

/** One outgoing internal message, as TonConnect `sendTransaction` takes it. */
export interface TonMessage {
  /** Destination address (friendly form). */
  address: string;
  /** Nanotons attached, as a decimal string. */
  amount: string;
  /** Message body as a base64 BoC. */
  payload: string;
}

/** An unsigned TON transaction, as handed to a wallet to sign and send. */
export interface TonUnsignedTransaction {
  /** Unix seconds after which the wallet must not send it. */
  validUntil: number;
  messages: TonMessage[];
}

/**
 * Structural raw-tx shape shared with the other spoke chains (see `RawTxReturnType`). `to` is where the
 * message goes (the reserve for native TON, the sender's own jetton wallet for a jetton), `value` the
 * nanotons attached, and `data` the base64 BoC body carrying the memo.
 */
export type TonRawTransaction = {
  from: string;
  to: string;
  value: bigint;
  data: string;
  token: string;
};

export type TonReturnType<Raw extends boolean> = Raw extends true
  ? TonRawTransaction
  : Raw extends false
    ? string
    : TonRawTransaction | string;

/** A toncenter `getTransactions` entry (the fields the sdk reads). */
export type TonRawTransactionReceipt = {
  transaction_id: { hash: string; lt: string };
  utime?: number;
  in_msg?: { source?: string; destination?: string; value?: string; msg_data?: { body?: string; text?: string } };
};

/** Nanotons a deposit attaches to carry its message. */
export type TonGasEstimate = {
  fee: bigint;
};

/**
 * A TonConnect `signData` result: the ed25519 signature plus the envelope fields the wallet bound into
 * it, which the relay needs to rebuild the signed digest.
 */
export interface TonSignedMessage {
  signature: `0x${string}`;
  /** Signer wallet workchain (0 basechain, -1 masterchain). */
  workchain: number;
  /** 32-byte signer wallet account id. */
  addressHash: `0x${string}`;
  /** App domain the wallet bound in. */
  domain: string;
  /** Unix seconds the wallet stamped. */
  timestamp: number;
  /** Payload encoding the wallet signed. */
  payloadType: 'txt' | 'bin';
}

export interface ITonWalletProvider extends ICoreWallet {
  readonly chainType: 'TON';
  /** The account's 32-byte ed25519 public key — its identity, and the SDK's address for it. */
  getWalletAddress: () => Promise<`0x${string}`>;
  /**
   * The friendly address the wallet actually sends from. For a raw key this is its wallet-v4R2 address;
   * a TonConnect wallet reports its own, which differs for another wallet version (e.g. W5).
   */
  getAccountAddress: () => Promise<string>;
  /** Sign and send a transaction from the connected wallet. */
  sendTransaction: (tx: TonUnsignedTransaction) => Promise<void>;
  /** `signData` a withdraw-auth message hash (scheme 5); returns the signature and its envelope. */
  signMessage: (hash: `0x${string}`) => Promise<TonSignedMessage>;
}
