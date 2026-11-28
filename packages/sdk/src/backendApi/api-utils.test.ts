/**
 * Unit tests for the shared HTTP helpers in `api-utils.ts`.
 *
 * `makeRequest` is the single low-level fetch primitive used by every backend
 * client (`BackendApiService`, `SwapsApiService`). These tests exercise it
 * DIRECTLY (not through a service) so that all of its invariants — URL
 * resolution, header/timeout precedence, method/body forwarding, and the three
 * throw paths — are pinned at their source. The service-level tests
 * (`BackendApiService.test.ts`, `SwapsApiService.test.ts`) cover how each
 * service's private `request` wrapper folds config + wraps the outcome in
 * `Result<T>`; the generic plumbing invariants live here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BACKEND_API_TIMEOUT, type SodaxLogger } from '@sodax/types';
import {
  BackendHttpError,
  isBackendHttpError,
  makeRequest,
  type RequestConfig,
  type RequestOverrideConfig,
} from './api-utils.js';
import { silentLogger } from '../shared/logger.js';

// --- fetch stub -----------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const BASE = 'https://api.example.com';

// --- helpers --------------------------------------------------------------
const okResponse = <T>(data: T) => ({ ok: true, status: 200, json: vi.fn().mockResolvedValue(data) });
const httpErrorResponse = (status: number, text: string) => ({
  ok: false,
  status,
  text: vi.fn().mockResolvedValue(text),
});
const abortFetchImpl = (_url: string, init: { signal: AbortSignal }) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
const stallUntilAbort = <T>(signal: AbortSignal | null | undefined): Promise<T> =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
/** Resolve to the thrown error instead of rejecting, so it can be inspected. */
const caught = (p: Promise<unknown>): Promise<unknown> => p.then(v => v).catch(e => e);
/** The `init` object passed to the most recent fetch call. */
const lastInit = () => mockFetch.mock.calls.at(-1)?.[1] as RequestInit;
/**
 * Thin adapter for the tests: `makeRequest` takes a single `MakeRequestParams` object with a
 * required `logger` and `serviceLabel`. Every test still exercises `makeRequest` directly — this
 * folds in the (required) silent logger so the error-path tests stay quiet, plus a fixed label.
 */
const run = <T>(endpoint: string, config: RequestConfig, overrideConfig?: RequestOverrideConfig): Promise<T> =>
  makeRequest<T>({ endpoint, config, overrideConfig, logger: silentLogger, serviceLabel: 'TestService' });

beforeEach(() => mockFetch.mockReset());
afterEach(() => vi.restoreAllMocks());

// =========================================================================
// makeRequest — URL / baseURL resolution
// =========================================================================

describe('makeRequest URL resolution', () => {
  it.each([
    [BASE, `${BASE}/foo`],
    [`${BASE}///`, `${BASE}/foo`],
    [`${BASE}/v1/`, `${BASE}/v1/foo`],
  ])('builds the URL from config.baseURL %s + endpoint, trimming trailing slashes', async (baseURL, expected) => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run('/foo', { method: 'GET', baseURL });
    expect(mockFetch).toHaveBeenCalledWith(expected, expect.objectContaining({ method: 'GET' }));
  });

  it('lets a (trimmed) overrideConfig.baseURL win, treating an empty-string override as not provided', async () => {
    mockFetch.mockResolvedValue(okResponse({}));
    await run('/foo', { method: 'GET', baseURL: BASE }, { baseURL: 'https://override.example.com/v1/' });
    expect(mockFetch).toHaveBeenLastCalledWith('https://override.example.com/v1/foo', expect.any(Object));

    await run('/foo', { method: 'GET', baseURL: BASE }, { baseURL: '' });
    expect(mockFetch).toHaveBeenLastCalledWith(`${BASE}/foo`, expect.any(Object));
  });

  it('produces a relative URL (endpoint only) when neither override nor config supply a baseURL', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run('/foo', { method: 'GET' });
    expect(mockFetch).toHaveBeenCalledWith('/foo', expect.any(Object));
  });
});

// =========================================================================
// makeRequest — request forwarding (method / body / signal / headers)
// =========================================================================

describe('makeRequest request forwarding', () => {
  it('a bare GET forwards the method and an AbortSignal, no body, empty headers, and returns the parsed JSON', async () => {
    const body = { hello: 'world', n: 1 };
    mockFetch.mockResolvedValueOnce(okResponse(body));
    const result = await run<typeof body>('/foo', { method: 'GET', baseURL: BASE });
    expect(result).toEqual(body);
    const init = lastInit();
    expect(init.method).toBe('GET');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({});
  });

  it('forwards a POST body verbatim', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run('/foo', { method: 'POST', baseURL: BASE, body: '{"x":1}' });
    const init = lastInit();
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"x":1}');
  });

  it('merges config.headers with overrideConfig.headers, the override winning per key', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run(
      '/foo',
      { method: 'GET', baseURL: BASE, headers: { Accept: 'application/json', 'X-Base': 'b' } },
      { headers: { Accept: 'text/plain', 'X-Custom': 'v' } },
    );
    expect(lastInit().headers).toEqual({ Accept: 'text/plain', 'X-Base': 'b', 'X-Custom': 'v' });
  });
});

// =========================================================================
// makeRequest — timeout resolution (asserted via the setTimeout delay)
// =========================================================================

describe('makeRequest timeout', () => {
  it('resolves the timeout as override > config > DEFAULT_BACKEND_API_TIMEOUT', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    mockFetch.mockResolvedValue(okResponse({}));
    await run('/foo', { method: 'GET', baseURL: BASE, timeout: 1234 }, { timeout: 50 });
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 50);
    await run('/foo', { method: 'GET', baseURL: BASE, timeout: 1234 });
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 1234);
    await run('/foo', { method: 'GET', baseURL: BASE });
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), DEFAULT_BACKEND_API_TIMEOUT);
  });

  it('clears the timeout after both a successful and a failed response', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await run('/foo', { method: 'GET', baseURL: BASE });
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

    mockFetch.mockResolvedValueOnce(httpErrorResponse(404, 'Not Found'));
    await caught(run('/foo', { method: 'GET', baseURL: BASE }));
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);
  });

  it('throws REQUEST_TIMEOUT with the elapsed timeout as cause when aborted by the timeout', async () => {
    mockFetch.mockImplementationOnce(abortFetchImpl);
    const err = (await caught(run('/foo', { method: 'GET', baseURL: BASE, timeout: 5 }))) as Error;
    expect(err.message).toBe('REQUEST_TIMEOUT');
    expect((err.cause as Error).message).toMatch(/Request timeout after 5ms/);
  });

  it.each([
    ['success', { ok: true, status: 200 }, 'json'],
    ['error', { ok: false, status: 503 }, 'text'],
  ] as const)('times out when %s response headers arrive but the body stalls', async (_label, head, reader) => {
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) =>
      Promise.resolve({ ...head, [reader]: () => stallUntilAbort(init.signal) }),
    );

    const err = (await caught(run('/foo', { method: 'GET', baseURL: BASE, timeout: 5 }))) as Error;

    expect(err.message).toBe('REQUEST_TIMEOUT');
    expect((err.cause as Error).message).toBe('Request timeout after 5ms');
  });
});

// =========================================================================
// makeRequest — error paths
// =========================================================================

describe('makeRequest error handling', () => {
  it('throws HTTP_REQUEST_FAILED with the status + text as cause on a non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce(httpErrorResponse(500, 'Internal Server Error'));
    const err = (await caught(run('/foo', { method: 'GET', baseURL: BASE }))) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('HTTP_REQUEST_FAILED');
    expect((err.cause as Error).message).toMatch(/HTTP 500: Internal Server Error/);
  });

  it('re-throws a non-abort Error verbatim (e.g. a network failure), logging under the caller-provided serviceLabel', async () => {
    const logger: SodaxLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const networkError = new Error('Network down');
    mockFetch.mockRejectedValueOnce(networkError);
    const err = await caught(
      makeRequest({
        endpoint: '/foo',
        config: { method: 'GET', baseURL: BASE },
        logger,
        serviceLabel: 'SwapsApiService',
      }),
    );
    expect(err).toBe(networkError);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[SwapsApiService]'), expect.any(Error));
  });

  it('throws UNKNOWN_REQUEST_ERROR wrapping a non-Error rejection value', async () => {
    mockFetch.mockRejectedValueOnce('string-not-error');
    const err = (await caught(run('/foo', { method: 'GET', baseURL: BASE }))) as Error;
    expect(err.message).toBe('UNKNOWN_REQUEST_ERROR');
    expect(err.cause).toBe('string-not-error');
  });
});

describe('BackendHttpError', () => {
  it('exposes the status and the parsed body so callers need not regex the cause message', async () => {
    const body = { statusCode: 409, error: 'SPONSOR_SEQUENCE_CONFLICT', message: 'sequence conflict' };
    mockFetch.mockResolvedValueOnce(httpErrorResponse(409, JSON.stringify(body)));

    const err = (await caught(run('/foo', { method: 'GET', baseURL: BASE }))) as BackendHttpError;

    expect(err).toBeInstanceOf(BackendHttpError);
    expect(err.status).toBe(409);
    expect(err.body).toEqual(body);
    expect(err.bodyText).toBe(JSON.stringify(body));
  });

  it('keeps the legacy message and cause chain, and leaves `body` undefined for a non-JSON or empty payload', () => {
    const err = new BackendHttpError(502, '<html>Bad Gateway</html>');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('HTTP_REQUEST_FAILED');
    expect((err.cause as Error).message).toBe('HTTP 502: <html>Bad Gateway</html>');
    expect(err.body).toBeUndefined();
    expect(err.bodyText).toBe('<html>Bad Gateway</html>');
    expect(new BackendHttpError(204, '').body).toBeUndefined();
  });
});

describe('isBackendHttpError', () => {
  it('recognises a real instance and a structurally-identical error from ANOTHER bundled copy of the SDK', () => {
    class ForeignBackendHttpError extends Error {
      readonly status = 503;
      constructor() {
        super('HTTP_REQUEST_FAILED');
        this.name = 'BackendHttpError';
      }
    }
    const foreign = new ForeignBackendHttpError();
    expect(isBackendHttpError(new BackendHttpError(500, 'boom'))).toBe(true);
    expect(foreign instanceof BackendHttpError).toBe(false);
    expect(isBackendHttpError(foreign)).toBe(true);
  });

  it.each([
    ['a plain Error with the same message', new Error('HTTP_REQUEST_FAILED')],
    ['a same-named error without a numeric status', Object.assign(new Error('x'), { name: 'BackendHttpError' })],
    ['a bare object', { name: 'BackendHttpError', status: 500 }],
  ])('rejects %s', (_label, value) => {
    expect(isBackendHttpError(value)).toBe(false);
  });
});
