import type { Base64String } from '../shared/shared.js';
import type { ICoreWallet } from '../wallet/wallet.js';
import type { VersionedTransactionResponse } from './solana-web3.js';

export type SolanaEoaAddress = string;
export type TransactionSignature = string;
export type SolanaSerializedTransaction = Uint8Array;
export type SolanaBase58PublicKey = string;

export type SolanaRawTransaction = {
  from: SolanaBase58PublicKey;
  to: SolanaBase58PublicKey;
  value: bigint;
  data: Base64String;
};

export type SolanaReturnType<Raw extends boolean> = Raw extends true
  ? SolanaRawTransaction
  : Raw extends false
    ? string
    : SolanaRawTransaction | string;

type Context = {
  slot: number;
};

export type SolanaAccountMeta = {
  pubkey: SolanaBase58PublicKey;
  isSigner: boolean;
  isWritable: boolean;
};

export type SolanaRawTransactionInstruction = {
  keys: Array<SolanaAccountMeta>;
  programId: SolanaBase58PublicKey;
  data: Uint8Array;
};

export type SolanaTokenAmount = {
  /** Raw amount, ignoring decimals. */
  amount: string;
  decimals: number;
  /** Decimal-adjusted float. */
  uiAmount: number | null;
  /** Decimal-adjusted string. */
  uiAmountString?: string;
};

type TokenAmount = {
  /** Raw amount, ignoring decimals. */
  amount: string;
  decimals: number;
  /** Decimal-adjusted float. */
  uiAmount: number | null;
  /** Decimal-adjusted string. */
  uiAmountString?: string;
};

export type SolanaRpcResponseAndContext<T> = {
  context: Context;
  value: T;
};

export type SolanaSignatureResult = {
  err: TransactionError | null;
};

type RpcResponseAndContext<T> = {
  context: Context;
  value: T;
};

export type Commitment =
  | 'processed'
  | 'confirmed'
  | 'finalized'
  | 'recent'
  | 'single'
  | 'singleGossip'
  | 'root'
  | 'max';

type TransactionError = {} | string;

export type RawTransaction = {
  signatures: { publicKey: string; signature: string | null }[];
  message: {
    header: {
      numRequiredSignatures: number;
      numReadonlySignedAccounts: number;
      numReadonlyUnsignedAccounts: number;
    };
    accountKeys: string[];
    recentBlockhash: string;
    instructions: {
      programIdIndex: number;
      accounts: number[];
      data: string; // base64
    }[];
  };
};

export type SolanaRawTransactionReceipt = VersionedTransactionResponse;

export interface ISolanaWalletProvider extends ICoreWallet {
  readonly chainType: 'SOLANA';
  getWalletAddress: () => Promise<string>;
  sendTransaction: (rawTransaction: Uint8Array | Array<number>) => Promise<TransactionSignature>;
  /** For an unsigned `SolanaRawTransaction` (e.g. from the Swaps API). */
  signAndSendTransaction?: (params: SolanaRawTransaction) => Promise<TransactionSignature>;
  waitForConfirmation: (
    signature: TransactionSignature,
    commitment: Commitment,
  ) => Promise<SolanaRpcResponseAndContext<SolanaSignatureResult>>;
  buildV0Txn: (instructions: SolanaRawTransactionInstruction[]) => Promise<SolanaSerializedTransaction>;
  getWalletBase58PublicKey: () => SolanaBase58PublicKey;
  getAssociatedTokenAddress: (mint: SolanaBase58PublicKey) => Promise<SolanaBase58PublicKey>;
  getBalance: (publicKey: SolanaBase58PublicKey) => Promise<number>;
  getTokenAccountBalance: (publicKey: SolanaBase58PublicKey) => Promise<RpcResponseAndContext<TokenAmount>>;
}
