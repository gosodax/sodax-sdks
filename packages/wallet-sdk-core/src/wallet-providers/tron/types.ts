import type { TronSignedTransaction, TronUnsignedTransaction } from '@sodax/types';

/** Provider defaults, read once in the constructor. */
export type TronWalletDefaults = {
  /** TronGrid-compatible RPC for broadcast and reads. Default `https://api.trongrid.io`. */
  rpcUrl?: string;
};

/** Minimal TronWeb surface the provider needs, structural so this package needs no `tronweb` dep. */
export interface TronWebLike {
  defaultAddress?: { base58?: string | false };
  fullNode?: { host?: string };
  address?: { toHex: (base58: string) => string };
  trx: {
    sign: (transaction: TronUnsignedTransaction) => Promise<TronSignedTransaction>;
    signMessageV2: (message: string) => Promise<string>;
    getBalance?: (address?: string) => Promise<number>;
    sendRawTransaction?: (signed: unknown) => Promise<{ result?: boolean; txid?: string; message?: string }>;
  };
}

/** Configuration for constructing a `TronWalletProvider` backed by a raw private key. */
export type PrivateKeyTronWalletConfig = {
  /** 64-hex secp256k1 key (with or without `0x`). */
  privateKey: string;
  /** TronGrid-compatible RPC for broadcast and reads; overrides `defaults.rpcUrl`. */
  endpoint?: string;
  defaults?: TronWalletDefaults;
};

/** The provider TIP-6963 announces. Its `tronWeb` is the connected one; the global one may have no account. */
export interface TronProviderLike {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
  /** The wallet's connected TronWeb, used for signing. */
  tronWeb?: TronWebLike;
}

/**
 * Configuration for constructing a `TronWalletProvider` backed by a browser extension (TronLink). Pass `tronWeb`,
 * `getProvider`, or both: `getProvider` alone still signs with a wallet discovered after construction.
 */
export type BrowserExtensionTronWalletConfig = {
  /** The injected TronWeb: the address fallback, and the signer when no announced provider's TronWeb has an account. */
  tronWeb?: TronWebLike;
  /** The announced provider, used for signing. */
  provider?: TronProviderLike;
  /** Resolves the connected provider at call time; prefer it, since a captured one can be stale. */
  getProvider?: () => TronProviderLike | undefined;
  /** Connected base58 address; falls back to `tronWeb.defaultAddress.base58`. */
  address?: string;
  endpoint?: string;
  defaults?: TronWalletDefaults;
};

export type TronWalletConfig = PrivateKeyTronWalletConfig | BrowserExtensionTronWalletConfig;
