import type { EvmChainKey, EvmRawTransaction } from '@sodax/types';
import type {
  Account,
  Chain,
  HttpTransportConfig,
  PublicClient,
  PublicClientConfig,
  SendTransactionParameters,
  Transport,
  WaitForCallsStatusParameters,
  WaitForTransactionReceiptParameters,
  WalletClient,
  WalletClientConfig,
} from 'viem';

/** Send-tx execution params (gas/nonce/fees). Disjoint from EvmRawTransaction by type — no field collision possible. */
export type EvmSendTransactionPolicy = Omit<Partial<SendTransactionParameters>, keyof EvmRawTransaction>;

/** Wait-for-receipt params (confirmations/polling/timeout). `hash` is positional, not part of the policy. */
export type EvmWaitForTransactionReceiptPolicy = Partial<Omit<WaitForTransactionReceiptParameters, 'hash'>>;

/**
 * Wait-for-batch params (polling/timeout). `id` is positional; viem's `status` predicate is left out so a
 * batch is only ever reported once it is terminal.
 */
export type EvmWaitForCallsStatusPolicy = Partial<Omit<WaitForCallsStatusParameters, 'id' | 'status'>>;

/**
 * Defaults applied to every call. Per-call options shallow-merge over these.
 * `publicClient`/`walletClient`/`transport` only apply in private-key mode
 * (consumer brings clients in browser-extension mode).
 */
export type EvmWalletDefaults = {
  publicClient?: Partial<Omit<PublicClientConfig, 'transport' | 'chain'>>;
  walletClient?: Partial<Omit<WalletClientConfig, 'transport' | 'chain' | 'account'>>;
  transport?: HttpTransportConfig;
  sendTransaction?: EvmSendTransactionPolicy;
  waitForTransactionReceipt?: EvmWaitForTransactionReceiptPolicy;
  waitForCallsStatus?: EvmWaitForCallsStatusPolicy;
};

/** Configuration for constructing an `EvmWalletProvider` backed by a raw private key. */
export type PrivateKeyEvmWalletConfig = {
  privateKey: `0x${string}`;
  chainId: EvmChainKey;
  rpcUrl?: `http${string}`;
  defaults?: EvmWalletDefaults;
};

/** Configuration for constructing an `EvmWalletProvider` backed by a browser-extension wallet (viem clients). */
export type BrowserExtensionEvmWalletConfig = {
  walletClient: WalletClient<Transport, Chain, Account>;
  publicClient: PublicClient;
  defaults?: EvmWalletDefaults;
};

export type EvmWalletConfig = PrivateKeyEvmWalletConfig | BrowserExtensionEvmWalletConfig;
