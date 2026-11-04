import { DEFAULT_BACKEND_API_TIMEOUT, type SodaxLogger } from '@sodax/types';
import type { SodaxErrorContext, SodaxFeature } from '../errors/codes.js';
import { SodaxError } from '../errors/SodaxError.js';

/**
 * Shape used to type certain backend responses that include a `data` envelope.
 * Not all endpoints use this wrapper — the `request` method parses raw JSON
 * directly as `T` without any envelope. Use this interface only when a specific
 * endpoint is documented to return `{ data, status, message? }`.
 */
export interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  message?: string;
}

/** Shape passed to `makeRequest` to configure a single HTTP call. */
export interface RequestConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  baseURL?: string;
  /** Honoured only via {@link resolveRequestConfig}; `makeRequest` expands `overrideConfig.apiKey`, not this field. */
  apiKey?: string;
}

/**
 * Per-call overrides that take precedence over the `ApiConfig` the service
 * was constructed with. Useful for directing a single request to a different
 * host or applying request-specific headers (e.g. auth tokens, tracing IDs).
 */
export type RequestOverrideConfig = {
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
  /**
   * Per-call API key, sent as the `x-api-key` header. Wins over the service's configured key; an
   * explicit `headers['x-api-key']` on this same override wins over it.
   */
  apiKey?: string;
};

/** Canonical (lower-case) name of the backend API-key header. */
const API_KEY_HEADER = 'x-api-key';

/**
 * The `x-api-key` header for an `apiKey` convenience option, or nothing when it is unset. An empty
 * string counts as unset — a set-but-empty env var must fall back rather than send a blank credential,
 * matching how {@link resolveRequestConfig} and `layerConfigs` treat an empty `baseURL`.
 */
export function apiKeyHeader(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { [API_KEY_HEADER]: apiKey } : {};
}

/**
 * Merge header records left to right, comparing names case-insensitively. HTTP header names are
 * case-insensitive and `fetch` folds two casings of one name into a single comma-joined value instead
 * of letting the later one win — so a plain spread of `{'x-api-key'}` under a caller's `{'X-Api-Key'}`
 * would send both, which is neither key. The last source to set a name supplies its casing and value.
 *
 * Kept in step with the identical helper in `@sodax/swaps-api`'s and `@sodax/bridge-api`'s `http.ts` —
 * neither package can import from the SDK, and this copy also serves the non-swaps services here.
 */
export function mergeHeaders(...sources: Array<Record<string, string> | undefined>): Record<string, string> {
  const byName = new Map<string, [name: string, value: string]>();
  for (const source of sources) {
    for (const entry of Object.entries(source ?? {})) byName.set(entry[0].toLowerCase(), entry);
  }
  return Object.fromEntries(byName.values());
}

/**
 * Bake a config-level `apiKey` into a service config's headers, so every request that service makes
 * carries it. Explicitly configured headers still win, matching the per-call expansion's rule.
 */
export function withApiKey<T extends { headers: Record<string, string> }>(config: T, apiKey: string | undefined): T {
  return { ...config, headers: mergeHeaders(apiKeyHeader(apiKey), config.headers) };
}

/**
 * Merge `source` into `target` IN PLACE, with the same case-insensitive last-write-wins rule as
 * {@link mergeHeaders}. Used by the services' `setHeaders`, where a plain `target[name] = value` is
 * unsafe: updating an existing key does NOT move it in insertion order, so a caller who once wrote
 * `X-Api-Key` and later rewrites `x-api-key` would leave the stale casing sitting last and win the
 * merge — silently sending the superseded credential. Rebuilds in place so `headers` can stay
 * `readonly` on the services that hold it.
 */
export function assignHeaders(target: Record<string, string>, source: Record<string, string>): void {
  const merged = mergeHeaders(target, source);
  for (const name of Object.keys(target)) delete target[name];
  Object.assign(target, merged);
}

/**
 * Non-2xx failure with structured status and body. The legacy
 * `HTTP_REQUEST_FAILED` message and cause chain are preserved.
 */
export class BackendHttpError extends Error {
  readonly status: number;
  readonly bodyText: string;
  /** Parsed JSON, or `undefined` for empty or malformed bodies. */
  readonly body: unknown;

  constructor(status: number, bodyText: string) {
    super('HTTP_REQUEST_FAILED', { cause: new Error(`HTTP ${status}: ${bodyText}`) });
    this.name = 'BackendHttpError';
    this.status = status;
    this.bodyText = bodyText;
    this.body = safeJsonParse(bodyText);
  }
}

/** Bundle-safe guard that tolerates duplicate SDK copies. */
export function isBackendHttpError(error: unknown): error is BackendHttpError {
  if (error instanceof BackendHttpError) return true;
  return (
    error instanceof Error &&
    error.name === 'BackendHttpError' &&
    typeof (error as { status?: unknown }).status === 'number'
  );
}

function safeJsonParse(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Normalize base URLs before appending slash-prefixed endpoints.
 */
export function trimTrailingSlashes(baseURL: string): string {
  let end = baseURL.length;
  while (end > 0 && baseURL[end - 1] === '/') end -= 1;
  return baseURL.slice(0, end);
}

export type MakeRequestParams = {
  endpoint: string;
  config: RequestConfig;
  overrideConfig?: RequestOverrideConfig;
  logger: SodaxLogger;
  /** Calling service's label, used only as the error-log prefix (e.g. `'SwapsApiService'`). */
  serviceLabel: string;
};

/**
 * `JSON.stringify` that is safe for request bodies containing `bigint` values (e.g. the Bridge API
 * quote/fee bodies whose numeric amounts are serialized as decimal strings). Plain `JSON.stringify`
 * throws `TypeError` on a `bigint`; this serializes each `bigint` to its decimal string form, matching
 * the wire shape the backend expects.
 */
export const toJsonBody = (value: unknown): string =>
  JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? val.toString() : val));

/**
 * Execute a single HTTP request and return the parsed JSON body.
 *
 * Resolves the effective base URL, headers, and timeout from `config` (the
 * service defaults) merged with the optional per-call `overrideConfig`, which
 * takes precedence. Applies an `AbortController`-backed timeout. Throws on
 * non-2xx status codes or when the request exceeds the timeout, so callers
 * should use {@link request} instead of calling this directly.
 *
 * @throws {@link BackendHttpError} (message `'HTTP_REQUEST_FAILED'`) on non-2xx responses.
 * @throws `Error('REQUEST_TIMEOUT')` when the request exceeds the timeout.
 * @throws `Error('UNKNOWN_REQUEST_ERROR')` for any other unexpected failure.
 */
export async function makeRequest<T>(params: MakeRequestParams): Promise<T> {
  const { endpoint, config, overrideConfig = {}, logger, serviceLabel } = params;
  // Truthy (not nullish) fallback mirrors the original behavior: an empty-string
  // baseURL is treated as "not provided" and falls back to the service default.
  const baseURL = overrideConfig.baseURL || config.baseURL || '';
  const url = `${trimTrailingSlashes(baseURL)}${endpoint}`;
  // Per-call override headers take precedence over the service defaults, and an explicit override
  // `x-api-key` header wins over the override's `apiKey` convenience option.
  const headers = mergeHeaders(config.headers, apiKeyHeader(overrideConfig.apiKey), overrideConfig.headers);

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeout = overrideConfig.timeout ?? config.timeout ?? DEFAULT_BACKEND_API_TIMEOUT;
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: config.method,
      headers,
      body: config.body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new BackendHttpError(response.status, errorText);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('REQUEST_TIMEOUT', { cause: new Error(`Request timeout after ${timeout}ms`) });
      }
      logger.error(`[${serviceLabel}] Request error`, error);
      throw error;
    }

    logger.error(`[${serviceLabel}] Unknown error`, error);
    throw new Error('UNKNOWN_REQUEST_ERROR', { cause: error });
  } finally {
    // Keep the deadline active while consuming the response body: fetch resolves as soon as headers
    // arrive, but text()/json() can still stall indefinitely.
    clearTimeout(timeoutId);
  }
}

/**
 * Apply per-call config over service defaults. Headers merge with the override
 * winning; an empty base URL falls back to the default. The per-call `apiKey` is expanded here and
 * dropped from the result, so the transport never re-applies it.
 */
export function resolveRequestConfig(
  config: RequestConfig,
  defaults: { baseURL: string; timeout: number; headers: Record<string, string> },
): RequestConfig {
  const { baseURL, timeout, headers, apiKey, ...rest } = config;
  return {
    ...rest,
    baseURL: baseURL || defaults.baseURL,
    timeout: timeout ?? defaults.timeout,
    headers: mergeHeaders(defaults.headers, apiKeyHeader(apiKey), headers),
  };
}

/** Preserve a transport failure and lift its HTTP status into error context. */
export function toExternalApiError(params: {
  api: NonNullable<SodaxErrorContext['api']>;
  feature: SodaxFeature;
  endpoint: string;
  error: unknown;
}): SodaxError<'EXTERNAL_API_ERROR'> {
  const { api, feature, endpoint, error } = params;
  const context: SodaxErrorContext = { api, endpoint };
  if (isBackendHttpError(error)) context.status = error.status;
  return new SodaxError(
    'EXTERNAL_API_ERROR',
    error instanceof Error ? error.message : `Request to ${endpoint} failed`,
    { feature, cause: error, context },
  );
}

/** Report response-contract drift without a transport `cause`. */
export function toInvalidResponseShapeError(params: {
  api: NonNullable<SodaxErrorContext['api']>;
  feature: SodaxFeature;
  endpoint: string;
  issues: unknown;
}): SodaxError<'EXTERNAL_API_ERROR'> {
  const { api, feature, endpoint, issues } = params;
  return new SodaxError('EXTERNAL_API_ERROR', `Invalid response shape from ${api} API for ${endpoint}`, {
    feature,
    context: { api, endpoint, reason: 'invalid_response_shape', issues },
  });
}
