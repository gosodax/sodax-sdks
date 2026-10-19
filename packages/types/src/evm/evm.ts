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
  address: Address; // Target address of the call
  value: bigint; // Ether value to send (in wei as a string for precision)
  data: Hex; // Calldata for the call
};

// Ethereum JSON-RPC Spec based logs
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

// Ethereum JSON-RPC Spec based transaction receipt
export type EvmRawTransactionReceipt = {
  transactionHash: string; // 32-byte hash
  transactionIndex: string; // hex string, e.g., '0x1'
  blockHash: string; // 32-byte hash
  blockNumber: string; // hex string, e.g., '0x5BAD55'
  from: string; // 20-byte address
  to: string | null; // null if contract creation
  cumulativeGasUsed: string; // hex string
  gasUsed: string; // hex string
  contractAddress: string | null; // non-null only if contract creation
  logs: EvmRawLog[];
  logsBloom: string; // 256-byte bloom filter hex string
  status?: string; // '0x1' = success, '0x0' = failure (optional pre-Byzantium)
  type?: string; // '0x0', '0x1', or '0x2' for tx type
  effectiveGasPrice?: string; // hex string, only on EIP-1559 txs
};

export type EvmSendTransactionOptions = {
  // Refuse to send unless the wallet's active chain id matches; without it the tx goes to whatever chain the wallet is on.
  expectedChainId?: number;
};

/**
 * EIP-5792 `atomic` capability of a wallet on one chain. `'ready'` means the wallet can execute
 * atomically once the user approves an account upgrade (e.g. MetaMask's EIP-7702 smart account).
 */
export type EvmAtomicBatchSupport = 'supported' | 'ready' | 'unsupported';

export type EvmSendBatchOptions = {
  // Refuse to send unless the wallet's active chain id matches, as for `sendTransaction`.
  expectedChainId: number;
};

export type EvmWaitForBatchOptions = {
  /** How long to wait for the batch to reach a terminal status, in ms. */
  timeout?: number;
};

export type EvmBatchReceipt = {
  transactionHash: Hash;
  status: 'success' | 'reverted';
};

/** Terminal state of an EIP-5792 call batch. One receipt when the wallet executed it as one transaction. */
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
  /** EIP-5792 atomic-batch support for `chainId`. Optional — callers guard before use. */
  getAtomicBatchSupport?: (chainId: number) => Promise<EvmAtomicBatchSupport>;
  /**
   * Send `txs` as one EIP-5792 batch that must execute atomically (`atomicRequired`), in order.
   * Resolves to the wallet's batch id, not a transaction hash — read it from {@link waitForBatch}.
   */
  sendAtomicBatch?: (txs: readonly EvmRawTransaction[], options: EvmSendBatchOptions) => Promise<string>;
  /** Wait for a batch sent with {@link sendAtomicBatch} to reach a terminal state. Throws on timeout. */
  waitForBatch?: (batchId: string, options?: EvmWaitForBatchOptions) => Promise<EvmBatchResult>;
}
