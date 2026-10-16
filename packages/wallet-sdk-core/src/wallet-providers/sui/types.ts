import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { SuiTransaction } from '@sodax/types';

/**
 * signAndExecuteTxn behavior. Pre-flight dry-run is enabled by default — disable only when
 * paying gas for a doomed tx is acceptable.
 */
export type SuiSignAndExecutePolicy = {
  dryRun?: { enabled?: boolean };
};

/** getCoins pagination policy. */
export type SuiGetCoinsPolicy = {
  limit?: number;
};

/** Defaults applied to every call. Per-call options shallow-merge over these. */
export type SuiWalletDefaults = {
  signAndExecuteTxn?: SuiSignAndExecutePolicy;
  getCoins?: SuiGetCoinsPolicy;
};

/** Base64 transaction bytes plus the wallet's signature, as returned by wallet-standard signers. */
export type SuiSignedTransaction = {
  bytes: string;
  signature: string;
};

/**
 * gRPC-web endpoint, under either the current or the pre-gRPC name. They are mutually exclusive:
 * passing both is a configuration error, not a precedence question.
 */
export type SuiEndpointConfig =
  | { grpcUrl: string; rpcUrl?: never }
  /** @deprecated Renamed to `grpcUrl`. A `sui-node` serves gRPC-web on the origin it served JSON-RPC on. */
  | { grpcUrl?: never; rpcUrl: string };

/** Configuration for constructing a `SuiWalletProvider` backed by a mnemonic-derived private key. */
export type PrivateKeySuiWalletConfig = SuiEndpointConfig & {
  mnemonics: string;
  defaults?: SuiWalletDefaults;
};

/** Configuration for constructing a `SuiWalletProvider` backed by a browser-extension wallet. */
export type BrowserExtensionSuiWalletConfig = SuiEndpointConfig & {
  address: string;
  /**
   * Signs without broadcasting; takes the transaction positionally. dApp Kit's and
   * wallet-standard's signers are options-shaped, so they need a wrapper — see the README.
   */
  signTransaction: (txn: SuiTransaction) => Promise<SuiSignedTransaction>;
  defaults?: SuiWalletDefaults;
};

export type SuiWalletConfig = PrivateKeySuiWalletConfig | BrowserExtensionSuiWalletConfig;

export type PkSuiWallet = {
  keyPair: Ed25519Keypair;
};

export type BrowserExtensionSuiWallet = {
  address: string;
  signTransaction: (txn: SuiTransaction) => Promise<SuiSignedTransaction>;
};

export type SuiWallet = PkSuiWallet | BrowserExtensionSuiWallet;
