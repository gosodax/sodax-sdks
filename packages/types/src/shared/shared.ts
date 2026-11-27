// Must not import from any other module or package, to avoid circular dependencies.

export type ByteArray = Uint8Array;
export type Base64String = string;
export type Hex = `0x${string}`;
export type Hash = `0x${string}`;
export type Address = `0x${string}`;
export type HubAddress = Address;
export type OriginalAssetAddress = string;
export type HttpUrl = `http://${string}` | `https://${string}`;

export type TxPollingConfig = {
  pollingIntervalMs: number;
  maxTimeoutMs: number;
};

/** Serializable mirror of viem `fallback()` transport options, so this type stays dependency-free. */
export type RpcFallbackOptions = {
  /** Re-rank endpoints by latency instead of listed order (viem default: off; needs more than one endpoint). */
  rank?: boolean;
  /** Retries of the whole failover request (viem default: 3); each attempt tries the endpoints in listed order. */
  retryCount?: number;
  /** Milliseconds. */
  retryDelay?: number;
};

/** A non-empty `rpcUrls` supersedes the single `rpcUrl` (first entry is primary); absent or empty keeps single-endpoint behavior. */
export type RpcFailoverConfig = {
  rpcUrls?: readonly string[];
  rpcOptions?: RpcFallbackOptions;
};
