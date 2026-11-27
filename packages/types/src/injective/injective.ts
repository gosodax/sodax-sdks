import type { ICoreWallet } from '../wallet/wallet.js';

export interface SignDoc {
  /** Protobuf TxBody matching the representation in TxRaw. */
  bodyBytes: Uint8Array;
  /** Protobuf AuthInfo matching the representation in TxRaw. */
  authInfoBytes: Uint8Array;
  chainId: string;
  accountNumber: bigint;
}

export type JsonObject = unknown;

export type InjectiveEoaAddress = string;

export interface InjectiveCoin {
  readonly denom: string;
  readonly amount: string;
}

export interface InjectiveExecuteResult {
  readonly logs: readonly unknown[];
  readonly height: number;
  /** Non-empty upper-case hex. */
  readonly transactionHash: string;
  readonly events: readonly unknown[];
  readonly gasWanted: bigint;
  readonly gasUsed: bigint;
}

export interface InjectiveTxResponse {
  height: number;
  txHash: string;
  codespace: string;
  code: number;
  data?: string;
  rawLog: string;
  logs?: unknown[];
  info?: string;
  gasWanted: number;
  gasUsed: number;
  timestamp: string;
  events?: unknown[];
}

export type InjectiveReturnType<Raw extends boolean> = Raw extends true
  ? InjectiveRawTransaction
  : Raw extends false
    ? string
    : InjectiveRawTransaction | string;

export type InjectiveRawTransaction = {
  from: `0x${string}`;
  to: `0x${string}`;
  signedDoc: SignDoc;
};

export type InjectiveExecuteResponse = {
  height: number | undefined;
  transactionHash: string;
};

export type InjectiveEventAttribute = {
  key: string;
  value: string;
  index: boolean;
};

export type InjectiveEvent = {
  type: string;
  attributes: InjectiveEventAttribute[];
};

export type InjectiveStringEvent = {
  type: string;
  attributes: { key: string; value: string }[];
};

export type InjectiveTxLog = {
  msg_index: number;
  log: string;
  events: InjectiveStringEvent[];
};

/** Mirrors `TxResponse` from `@injectivelabs/sdk-ts` (Cosmos SDK). */
export type InjectiveRawTransactionReceipt = {
  txHash: string;
  height: number;
  code: number;
  codespace: string;
  data?: string;
  rawLog: string;
  info?: string;
  gasWanted: number;
  gasUsed: number;
  logs?: InjectiveTxLog[];
  events?: InjectiveEvent[];
  timestamp: string;
};

export interface IInjectiveWalletProvider extends ICoreWallet {
  readonly chainType: 'INJECTIVE';
  getWalletAddress: () => Promise<InjectiveEoaAddress>;
  execute: (
    senderAddress: InjectiveEoaAddress,
    contractAddress: string,
    msg: JsonObject,
    funds?: InjectiveCoin[],
  ) => Promise<InjectiveExecuteResponse>;
  /** Takes a proto-encoded Cosmos `TxRaw`; returns the tx hash. */
  sendTransaction?: (signedTxRaw: Uint8Array) => Promise<string>;
  /** For an unsigned `InjectiveRawTransaction` (e.g. from the Swaps API); returns the tx hash. */
  signAndSendTransaction?: (tx: InjectiveRawTransaction) => Promise<string>;
}
