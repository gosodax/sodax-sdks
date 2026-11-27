import type { ICoreWallet } from '../wallet/wallet.js';

// TON uses the MPC relay (memo = binary comment, or a jetton's `forward_payload`). An account's identity is its ed25519
// pubkey, not its address (`hash(StateInit)` cannot be inverted). Withdraw scheme 5 is a TonConnect `signData`.

export interface TonMessage {
  /** Friendly form. */
  address: string;
  /** Nanotons attached, as a decimal string. */
  amount: string;
  /** Base64 BoC. */
  payload: string;
}

export interface TonUnsignedTransaction {
  /** Unix seconds after which the wallet must not send it. */
  validUntil: number;
  messages: TonMessage[];
}

/**
 * `to` is the reserve for native TON or the sender's own jetton wallet for a jetton; `value` is nanotons;
 * `data` is the base64 BoC body carrying the memo.
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

/** Subset of a toncenter `getTransactions` entry the sdk reads. */
export type TonRawTransactionReceipt = {
  transaction_id: { hash: string; lt: string };
  utime?: number;
  in_msg?: { source?: string; destination?: string; value?: string; msg_data?: { body?: string; text?: string } };
};

/** Nanotons a deposit attaches to carry its message. */
export type TonGasEstimate = {
  fee: bigint;
};

/** The relay needs the envelope fields the wallet bound into the signature to rebuild the signed digest. */
export interface TonSignedMessage {
  signature: `0x${string}`;
  /** Signer wallet workchain (0 basechain, -1 masterchain). */
  workchain: number;
  /** 32-byte account id. */
  addressHash: `0x${string}`;
  domain: string;
  /** Unix seconds. */
  timestamp: number;
  payloadType: 'txt' | 'bin';
}

export interface ITonWalletProvider extends ICoreWallet {
  readonly chainType: 'TON';
  /** Returns the 32-byte ed25519 public key, which is the SDK's address for a TON account. */
  getWalletAddress: () => Promise<`0x${string}`>;
  /** Friendly sending address: wallet-v4R2 for a raw key; a TonConnect wallet reports its own (differs for e.g. W5). */
  getAccountAddress: () => Promise<string>;
  sendTransaction: (tx: TonUnsignedTransaction) => Promise<void>;
  /** TonConnect `signData` over the withdraw-auth message hash (scheme 5). */
  signMessage: (hash: `0x${string}`) => Promise<TonSignedMessage>;
}
