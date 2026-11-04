/** Defaults shared by both XRPL provider modes. */
export type XrpWalletDefaults = {
  /** rippled JSON-RPC used for reads and submission. Default `https://xrplcluster.com`. */
  rpcUrl?: string;
};

/**
 * Minimal GemWallet surface the provider needs, kept STRUCTURAL so this package takes no
 * dependency on `@gemwallet/api` — the same approach `TronWebLike` uses for TronLink. The app
 * passes the real API object in; only these four calls are ever used.
 */
export interface GemWalletLike {
  /** `getAddress()` → the connected classic `r…` address. */
  getAddress: () => Promise<{ result?: { address?: string } } | undefined>;
  /**
   * `getPublicKey()` → the account's public key, hex. For an ed25519 account this is the 33-byte
   * `0xED`-prefixed form, which is what withdraw-auth scheme 3 requires.
   */
  getPublicKey: () => Promise<{ result?: { publicKey?: string; address?: string } } | undefined>;
  /**
   * `signMessage(message, isHex)` → a signature over the message. With `isHex` GemWallet signs the
   * decoded bytes; without it, it signs the UTF-8 text of the string, which scheme 3 rejects.
   */
  signMessage: (message: string, isHex?: boolean) => Promise<{ result?: { signedMessage?: string } } | undefined>;
  /** `submitTransaction({ transaction })` → submits a Payment and returns its hash. */
  submitTransaction: (payload: {
    transaction: Record<string, unknown>;
  }) => Promise<{ result?: { hash?: string } } | undefined>;
}

/** Raw-key mode: signing happens locally via `xrpl`, for headless flows and tests. */
export type PrivateKeyXrpWalletConfig = {
  /**
   * 32-byte ed25519 seed/key as hex (with or without `0x`).
   *
   * MUST be ed25519: the relay's withdraw-auth scheme 3 verifies an ed25519 signature and derives
   * the identity as `ripemd160(sha256(pubkey))`. A secp256k1 XRPL account has no supported scheme,
   * so it can deposit and then never withdraw.
   */
  privateKey: string;
  endpoint?: string;
  defaults?: XrpWalletDefaults;
};

/** Browser mode: GemWallet holds the key and performs signing. */
export type GemWalletXrpWalletConfig = {
  gemWallet: GemWalletLike;
  /** Connected classic address; falls back to `getAddress()`. */
  address?: string;
  endpoint?: string;
  defaults?: XrpWalletDefaults;
};

export type XrpWalletConfig = PrivateKeyXrpWalletConfig | GemWalletXrpWalletConfig;
