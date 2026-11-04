import { SwapsApi } from '@sodax/swaps-api';
import { BACKEND_API_BASE_PATH, DEFAULT_BACKEND_API_TIMEOUT, type HttpUrl } from '@sodax/types';

const DEFAULT_SWAPS_API_BASE_URL: HttpUrl = 'https://canary-api.sodax.com/v1';

function isHttpUrl(value: unknown): value is HttpUrl {
  return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'));
}

function nonEmptyEnv(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
  return value.slice(0, end);
}

function resolveSwapsApiBaseUrl(raw: unknown): HttpUrl {
  if (!isHttpUrl(raw)) {
    if (nonEmptyEnv(raw)) {
      console.warn(
        `VITE_SWAPS_API_BASE_URL must be an HTTP(S) gateway root; falling back to ${DEFAULT_SWAPS_API_BASE_URL}.`,
      );
    }
    return DEFAULT_SWAPS_API_BASE_URL;
  }

  const normalized = trimTrailingSlashes(raw);
  if (!isHttpUrl(normalized)) {
    console.warn(
      `VITE_SWAPS_API_BASE_URL must be an HTTP(S) gateway root; falling back to ${DEFAULT_SWAPS_API_BASE_URL}.`,
    );
    return DEFAULT_SWAPS_API_BASE_URL;
  }

  if (normalized.endsWith(BACKEND_API_BASE_PATH)) {
    const gatewayRoot = normalized.slice(0, -BACKEND_API_BASE_PATH.length);
    if (isHttpUrl(gatewayRoot)) {
      console.warn(
        `VITE_SWAPS_API_BASE_URL should be the gateway root; trimmed the legacy ${BACKEND_API_BASE_PATH} suffix because the swaps route sits beside it, not under it.`,
      );
      return gatewayRoot;
    }
  }

  return normalized;
}

const rawBaseUrl: unknown = import.meta.env.VITE_SWAPS_API_BASE_URL;
/** Gateway root including the version prefix; a legacy `/be` suffix is trimmed with a warning. */
const baseUrl = resolveSwapsApiBaseUrl(rawBaseUrl);

/** Optional partner API key, sent as `x-api-key` (unset is fine until the backend enforces it). */
const rawApiKey: unknown = import.meta.env.VITE_SODAX_API_KEY;
const apiKey = nonEmptyEnv(rawApiKey) ? rawApiKey : undefined;

/** Single client with a hard per-call timeout; swaps-api owns HTTP and the wallet only signs. */
export const swapsApi = new SwapsApi({
  baseUrl,
  timeout: DEFAULT_BACKEND_API_TIMEOUT,
  ...(apiKey ? { apiKey } : {}),
});

/**
 * EVM spoke chains this example can sign for (createIntent returns an unsigned EVM tx that the
 * connected EVM wallet broadcasts). Non-EVM chains can still be quoted, just not executed here.
 */
export const EVM_CHAIN_KEYS = [
  'sonic',
  '0xa86a.avax',
  '0x2105.base',
  '0x38.bsc',
  '0xa.optimism',
  '0x89.polygon',
  '0x1.eth',
  '0xa4b1.arbitrum',
] as const;

export function isEvmChainKey(chainKey: string): boolean {
  return (EVM_CHAIN_KEYS as readonly string[]).includes(chainKey);
}
