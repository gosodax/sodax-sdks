import type { ICoreWallet } from '../wallet/wallet.js';

export type XDR = string;

// Horizon API transaction receipt
export type StellarRawTransactionReceipt = {
  _links: {
    self: { href: string };
    account: { href: string };
    ledger: { href: string };
    operations: { href: string };
    effects: { href: string };
    precedes: { href: string };
    succeeds: { href: string };
    transaction: { href: string };
  };
  id: string;
  paging_token: string;
  successful: boolean;
  hash: string;
  ledger_attr: number; // ledger sequence number
  created_at: string; // ISO 8601
  source_account: string;
  source_account_sequence: string;
  fee_account: string;
  fee_bump_transaction?: {
    hash: string;
    signatures: string[];
  };
  inner_transaction?: {
    hash: string;
    signatures: string[];
  };
  envelope_xdr: XDR; // base64
  result_xdr: XDR; // base64
  result_meta_xdr: XDR; // base64
  fee_meta_xdr: XDR; // base64
  memo?: string;
  memo_type?: string; // "text" | "id" | "hash" | "return"
  signatures: XDR[]; // base64
  valid_after?: string;
  valid_before?: string;
  fee_charged: number | string; // stroops
  max_fee: number | string; // stroops
  operation_count: number;
};

// Mirrors Soroban RPC `GetTransactionResponse` from `@stellar/stellar-sdk`; XDR fields omitted (complex subtypes).
type StellarSorobanBaseResponse = {
  latestLedger: number;
  latestLedgerCloseTime: number;
  oldestLedger: number;
  oldestLedgerCloseTime: number;
};

export type StellarSorobanSuccessfulTransactionReceipt = StellarSorobanBaseResponse & {
  status: 'SUCCESS';
  ledger: number;
  createdAt: number;
  applicationOrder: number;
  feeBump: boolean;
};

export type StellarSorobanFailedTransactionReceipt = StellarSorobanBaseResponse & {
  status: 'FAILED';
  ledger: number;
  createdAt: number;
  applicationOrder: number;
  feeBump: boolean;
};

export type StellarSorobanMissingTransactionReceipt = StellarSorobanBaseResponse & {
  status: 'NOT_FOUND';
};

export type StellarSorobanTransactionReceipt =
  | StellarSorobanSuccessfulTransactionReceipt
  | StellarSorobanFailedTransactionReceipt
  | StellarSorobanMissingTransactionReceipt;

export type StellarRawTransaction = {
  from: string;
  to: string;
  value: bigint;
  data: string;
};

export type StellarReturnType<Raw extends boolean> = Raw extends true
  ? StellarRawTransaction
  : Raw extends false
    ? string
    : StellarRawTransaction | string;

export interface IStellarWalletProvider extends ICoreWallet {
  readonly chainType: 'STELLAR';
  /** Does not broadcast. Without `options.address`, browser wallets sign with their active account. */
  signTransaction: (tx: XDR, options?: { address?: string }) => Promise<XDR>;
  waitForTransactionReceipt: (txHash: string) => Promise<StellarRawTransactionReceipt>;
  /** Broadcasts via the Soroban RPC server; returns the tx hash. */
  sendTransaction?: (signedTx: XDR) => Promise<string>;
  /** For an unsigned `StellarRawTransaction` (e.g. from the Swaps API); returns the tx hash. */
  signAndSendTransaction?: (params: StellarRawTransaction) => Promise<string>;
}
