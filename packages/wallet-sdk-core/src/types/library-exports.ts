/**
 * Re-exports of types AND runtime values from underlying chain SDKs.
 * Lets consumers import everything they need from `@sodax/wallet-sdk-core`
 * without taking direct dependencies on `viem`, `@mysten/sui`, etc.
 *
 * NOTE: this file intentionally exposes both `export type` and `export`
 * (runtime — e.g. Stellar `Networks`, Stacks `PostConditionMode` enum).
 * Hence the name `library-exports` rather than `library-types`.
 */

// ─── EVM (viem) ────────────────────────────────────────────────────────────
export type {
  Account,
  Address,
  Chain,
  Transport,
  PublicClient,
  WalletClient,
  HttpTransportConfig,
  PublicClientConfig,
  WalletClientConfig,
  SendTransactionParameters,
  WaitForTransactionReceiptParameters,
  TransactionReceipt,
} from 'viem';

// ─── Sui (@mysten/sui) ─────────────────────────────────────────────────────
export type { Transaction, TransactionArgument } from '@mysten/sui/transactions';

// ─── Solana (@solana/web3.js) ──────────────────────────────────────────────
export type { Commitment, ConnectionConfig, SendOptions } from '@solana/web3.js';

// ─── Injective ─────────────────────────────────────────────────────────────
export type { Network } from '@injectivelabs/networks';
export type { ChainId, EvmChainId } from '@injectivelabs/ts-types';
export type { MsgBroadcaster } from '@injectivelabs/wallet-core';

// ─── Stellar (@stellar/stellar-sdk) ────────────────────────────────────────
export { Networks } from '@stellar/stellar-sdk';

// ─── Stacks ────────────────────────────────────────────────────────────────
export { PostConditionMode } from '@sodax/libs/stacks/core';
export type { ClarityValue, PostConditionModeName } from '@sodax/libs/stacks/core';
export type { StacksNetwork } from '@sodax/libs/stacks/core';
export type { StacksProvider } from '@sodax/libs/stacks/connect';

// ─── Near ──────────────────────────────────────────────────────────────────
export type { KeyPairString } from 'near-api-js';
export type { NearConnector } from '@hot-labs/near-connect';

// ─── Bitcoin ───────────────────────────────────────────────────────────────
export type { Network as BitcoinJsNetwork } from 'bitcoinjs-lib/src/networks.js';
