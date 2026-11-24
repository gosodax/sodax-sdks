/** Defaults shared by both TON provider modes. */
export type TonWalletDefaults = {
  /** toncenter v2 JSON-RPC endpoint used by the raw-key mode. Default `https://toncenter.com/api/v2/jsonRPC`. */
  rpcUrl?: string;
};

/**
 * Minimal TonConnect surface the provider needs — `TonConnectUI` from `@tonconnect/ui` satisfies it. Kept
 * STRUCTURAL so this package takes no TonConnect dependency; the app passes the real instance in.
 */
export interface TonConnectLike {
  /** The connected account: raw `workchain:hex` address and hex public key (no `0x`). */
  readonly account: { address: string; publicKey?: string } | null;
  sendTransaction: (tx: {
    validUntil: number;
    messages: { address: string; amount: string; payload?: string }[];
  }) => Promise<unknown>;
  signData: (payload: { type: 'text'; text: string }) => Promise<{
    /** Base64 ed25519 signature. */
    signature: string;
    /** Raw `workchain:hex` address of the signing wallet. */
    address: string;
    timestamp: number;
    domain: string;
  }>;
}

/** Raw-key mode: signs locally with an ed25519 seed, sending from the key's wallet-v4R2 address. */
export type PrivateKeyTonWalletConfig = {
  /** 32-byte ed25519 seed as hex (with or without `0x`). */
  privateKey: string;
  /**
   * Domain bound into scheme-5 `signData` envelopes. The relay can require a specific app domain, so set
   * it to the domain the relay expects. Default `sodax.com`.
   */
  signDataDomain?: string;
  /** toncenter API key, to lift the keyless tier's ~1 req/s limit. */
  apiKey?: string;
  endpoint?: string;
  defaults?: TonWalletDefaults;
};

/** Browser mode: a TonConnect wallet holds the key and signs. */
export type TonConnectTonWalletConfig = {
  tonConnect: TonConnectLike;
  defaults?: TonWalletDefaults;
};

export type TonWalletConfig = PrivateKeyTonWalletConfig | TonConnectTonWalletConfig;
