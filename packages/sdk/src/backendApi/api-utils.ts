import { DEFAULT_BACKEND_API_TIMEOUT, type SodaxLogger } from '@sodax/types';
import type { SodaxErrorContext, SodaxFeature } from '../errors/codes.js';
import { SodaxError } from '../errors/SodaxError.js';

/** Optional `{ data, status, message? }` envelope; most endpoints return raw `T` without it. */
export interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  message?: string;
}

export interface RequestConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  baseURL?: string;
  /** Honoured only via {@link resolveRequestConfig}; `makeRequest` expands `overrideConfig.apiKey`, not this field. */
  apiKey?: string;
}

export type RequestOverrideConfig = {
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
  /** Sent as `x-api-key`; an explicit `headers['x-api-key']` on this override wins over it. */
  apiKey?: string;
};

const API_KEY_HEADER = 'x-api-key';

/** Empty string counts as unset, so a set-but-empty env var never sends a blank credential. */
export function apiKeyHeader(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { [API_KEY_HEADER]: apiKey } : {};
}

/**
 * Case-insensitive last-write-wins merge: `fetch` would comma-join two casings of one name into neither key.
 * Kept in step with the copies in `@sodax/swaps-api` / `@sodax/bridge-api` `http.ts` (they can't import the SDK).
 */
export function mergeHeaders(...sources: Array<Record<string, string> | undefined>): Record<string, string> {
  const byName = new Map<string, [name: string, value: string]>();
  for (const source of sources) {
    for (const entry of Object.entries(source ?? {})) byName.set(entry[0].toLowerCase(), entry);
  }
  return Object.fromEntries(byName.values());
}

/** Bake a config-level `apiKey` into headers; explicitly configured headers still win. */
export function withApiKey<T extends { headers: Record<string, string> }>(config: T, apiKey: string | undefined): T {
  return { ...config, headers: mergeHeaders(apiKeyHeader(apiKey), config.headers) };
}

/** In-place {@link mergeHeaders}: plain assignment keeps a stale key casing last, sending a superseded credential. */
export function assignHeaders(target: Record<string, string>, source: Record<string, string>): void {
  const merged = mergeHeaders(target, source);
  for (const name of Object.keys(target)) delete target[name];
  Object.assign(target, merged);
}

/** Non-2xx failure; keeps the legacy `HTTP_REQUEST_FAILED` message and cause chain. */
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
  serviceLabel: string;
};

/** `JSON.stringify` that serializes `bigint` as a decimal string, matching the backend wire shape. */
export const toJsonBody = (value: unknown): string =>
  JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? val.toString() : val));

/** Throws `BackendHttpError` on non-2xx, `REQUEST_TIMEOUT` on timeout, `UNKNOWN_REQUEST_ERROR` otherwise. */
export async function makeRequest<T>(params: MakeRequestParams): Promise<T> {
  const { endpoint, config, overrideConfig = {}, logger, serviceLabel } = params;
  // Truthy (not nullish): an empty-string baseURL falls back to the service default.
  const baseURL = overrideConfig.baseURL || config.baseURL || '';
  const url = `${trimTrailingSlashes(baseURL)}${endpoint}`;
  // Precedence: override `x-api-key` header > override `apiKey` > service headers.
  const headers = mergeHeaders(config.headers, apiKeyHeader(overrideConfig.apiKey), overrideConfig.headers);

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
    // Cleared only after the body is consumed: text()/json() can stall after headers arrive.
    clearTimeout(timeoutId);
  }
}

/** Empty `baseURL` falls back to the default; per-call `apiKey` is expanded here and dropped from the result. */
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
