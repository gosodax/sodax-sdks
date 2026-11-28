import { type Transport, fallback, http } from 'viem';
import type { RpcFailoverConfig } from '@sodax/types';

export type EvmRpcConfig = { rpcUrl: string } & RpcFailoverConfig;

/**
 * `rpcUrls` supersedes `rpcUrl` only with a non-blank entry, so unset env vars never suppress a healthy `rpcUrl`.
 * Endpoints are deduped (primary first); a single endpoint still yields a `fallback` transport.
 */
export function buildEvmRpcTransport(cfg: EvmRpcConfig): Transport {
  const configured = (cfg.rpcUrls ?? []).map(url => url.trim()).filter(url => url.length > 0);
  const urls = [...new Set(configured.length > 0 ? configured : [cfg.rpcUrl])];
  // `rank` runs a perpetual background poll: pointless (and a dangling timer) with a single endpoint.
  const rpcOptions = cfg.rpcOptions?.rank && urls.length < 2 ? { ...cfg.rpcOptions, rank: false } : cfg.rpcOptions;
  return fallback(
    urls.map(url => http(url)),
    rpcOptions,
  );
}
