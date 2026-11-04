import type { ZcashTransferParams } from '@sodax/types';

/** Defaults shared by both Zcash provider modes. */
export type ZcashWalletDefaults = Record<string, never>;

/**
 * Minimal browser-wallet surface the provider needs, kept STRUCTURAL so this package takes no wallet
 * dependency; a connector adapts the real wallet API to it.
 */
export interface ZcashWalletLike {
  /** The connected transparent `t1…` address. */
  getAddress: () => Promise<string>;
  /**
   * Pay `amount` zatoshis to `to` from the account's transparent funds and broadcast it; resolves to the txid.
   * Browser wallets build the transaction themselves rather than signing one the sdk built.
   */
  sendTransfer: (params: ZcashTransferParams) => Promise<string>;
  /** `signmessage` over `message` with the address key; returns the 65-byte compact signature as `0x` hex. */
  signMessage: (message: string) => Promise<`0x${string}`>;
}

/** Raw-key mode: a secp256k1 key signing locally. The same key an EVM wallet uses is a valid Zcash key. */
export type PrivateKeyZcashWalletConfig = {
  /** 32-byte secp256k1 private key as hex (with or without `0x`). */
  privateKey: string;
  defaults?: ZcashWalletDefaults;
};

/** Browser mode: a wallet holds the key and signs. */
export type BrowserExtensionZcashWalletConfig = {
  wallet: ZcashWalletLike;
  defaults?: ZcashWalletDefaults;
};

export type ZcashWalletConfig = PrivateKeyZcashWalletConfig | BrowserExtensionZcashWalletConfig;
