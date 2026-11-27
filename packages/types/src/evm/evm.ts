import type { Address, Hex, Hash } from '../shared/shared.js';
import type { ICoreWallet } from '../wallet/wallet.js';

export type EvmReturnType<Raw extends boolean> = Raw extends true
  ? EvmRawTransaction
  : Raw extends false
    ? Hex
    : Hex | EvmRawTransaction;

export type EvmRawTransaction = {
  from: Address;
  to: Address;
  value: bigint;
  data: Hex;
};

export type EvmContractCall = {
  address: Address;
  value: bigint; // wei
  data: Hex;
};

export type EvmRawLog = {
  address: Address;
  topics: [Hex, ...Hex[]] | [];
  data: Hex;
  blockHash: Hash | null;
  blockNumber: Address | null;
  logIndex: Hex | null;
  transactionHash: Hash | null;
  transactionIndex: Hex | null;
  removed: boolean;
};

export type EvmRawTransactionReceipt = {
  transactionHash: string; // 32-byte hash
  transactionIndex: string; // hex
  blockHash: string; // 32-byte hash
  blockNumber: string; // hex
  from: string; // 20-byte address
  to: string | null; // null if contract creation
  cumulativeGasUsed: string; // hex
  gasUsed: string; // hex
  contractAddress: string | null; // non-null only if contract creation
  logs: EvmRawLog[];
  logsBloom: string; // 256-byte hex
  status?: string; // '0x1' = success, '0x0' = failure (optional pre-Byzantium)
  type?: string; // '0x0', '0x1', or '0x2'
  effectiveGasPrice?: string; // hex, only on EIP-1559 txs
};

export type EvmSendTransactionOptions = {
  // Refuse to send unless the wallet's active chain id matches; without it the tx goes to whatever chain the wallet is on.
  expectedChainId?: number;
  /** Keep the original deposit identifier if the broadcast response is indeterminate. */
  preserveDepositOutcome?: boolean;
};

/** For recovering a wallet deposit for which no hash was returned. */
export type EvmDepositRecovery = {
  readonly kind: 'evm-deposit';
  readonly chainId: number;
  readonly transaction: EvmRawTransaction;
  readonly attemptedAtMs: number;
};

/** EIP-5792 `atomic` capability; `'ready'` = atomic once the user approves an account upgrade (e.g. EIP-7702). */
export type EvmAtomicBatchSupport = 'supported' | 'ready' | 'unsupported';

export type EvmSendBatchOptions = {
  // Refuse to send unless the wallet's active chain id matches, as for `sendTransaction`.
  expectedChainId: number;
};

export type EvmWaitForBatchOptions = {
  /** Milliseconds. */
  timeout?: number;
};

export type EvmBatchReceipt = {
  transactionHash: Hash;
  status: 'success' | 'reverted';
};

/** Terminal state of an EIP-5792 batch; one receipt when the wallet executed it as one transaction. */
export type EvmBatchResult = {
  status: 'success' | 'failure';
  /** EIP-5792 status code: 200 confirmed, 400 offchain failure, 500 reverted, 600 partially reverted. */
  statusCode: number;
  atomic: boolean;
  receipts: readonly EvmBatchReceipt[];
};

export interface IEvmWalletProvider extends ICoreWallet {
  readonly chainType: 'EVM';
  getWalletAddress: () => Promise<Address>;
  sendTransaction: (evmRawTx: EvmRawTransaction, options?: EvmSendTransactionOptions) => Promise<Hash>;
  waitForTransactionReceipt: (txHash: Hash) => Promise<EvmRawTransactionReceipt>;
  /** EIP-191 `personal_sign` over the raw 32-byte `hash` (not its hex text); required only for MPC-relay EVM spokes
   * (e.g. Monad) that authorize withdrawals by signature. */
  signMessage?: (hash: Hex) => Promise<Hex>;
  /** Optional — callers guard before use. */
  getAtomicBatchSupport?: (chainId: number) => Promise<EvmAtomicBatchSupport>;
  /** EIP-5792 batch with `atomicRequired`, in order; resolves to the batch id, not a tx hash (see {@link waitForBatch}). */
  sendAtomicBatch?: (txs: readonly EvmRawTransaction[], options: EvmSendBatchOptions) => Promise<string>;
  /** Throws on timeout. */
  waitForBatch?: (batchId: string, options?: EvmWaitForBatchOptions) => Promise<EvmBatchResult>;
}
