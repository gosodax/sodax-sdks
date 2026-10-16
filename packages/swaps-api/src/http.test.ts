import { afterEach, describe, expect, it, vi } from 'vitest';
import { SwapsApiError } from './errors.js';
import {
  API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE,
  type RequestContext,
  buildQuery,
  buildUrl,
  request,
} from './http.js';

const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const ctx = (fetchImpl: typeof globalThis.fetch): RequestContext => ({ baseUrl: 'https://api.test', fetchImpl });

const identity = (raw: unknown): unknown => raw;

describe('buildQuery', () => {
  it('returns empty string for no query', () => {
    expect(buildQuery(undefined)).toBe('');
    expect(buildQuery({})).toBe('');
  });

  it('serializes boolean and number and omits undefined', () => {
    expect(buildQuery({ a: 'x', n: 2, b: true, skip: undefined })).toBe('?a=x&n=2&b=true');
  });
});

describe('buildUrl', () => {
  it('joins base and path, trimming a trailing slash and adding a leading one', () => {
    expect(buildUrl('https://h', '/p')).toBe('https://h/p');
    expect(buildUrl('https://h/', '/p')).toBe('https://h/p');
    expect(buildUrl('https://h//', '/p')).toBe('https://h/p');
    expect(buildUrl('https://h', 'p')).toBe('https://h/p');
  });

  it('appends the query string', () => {
    expect(buildUrl('https://h', '/p', { a: 1 })).toBe('https://h/p?a=1');
  });
});

describe('request', () => {
  it('returns the parsed body on success and calls the right URL/method', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({ quotedAmount: '5' }));
    const out = await request(ctx(fetchImpl), {
      method: 'POST',
      path: '/swaps/quote',
      endpoint: 'getQuote',
      body: { token: 'A' },
      parse: identity,
    });
    expect(out).toEqual({ quotedAmount: '5' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://api.test/swaps/quote');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ token: 'A' }));
  });

  it('sends no body and no Content-Type for a bodyless GET', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => jsonResponse([]));
    await request(ctx(fetchImpl), { method: 'GET', path: '/swaps/tokens', endpoint: 'getTokens', parse: identity });
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(init?.body).toBeUndefined();
    expect((init?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('throws VALIDATION_ERROR (before fetch) when the body carries a stray bigint', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({}));
    await expect(
      request(ctx(fetchImpl), {
        method: 'POST',
        path: '/x',
        endpoint: 'createIntent',
        body: { amount: 1n },
        parse: identity,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps a non-2xx to HTTP_ERROR with status and parsed body', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({ message: 'bad request' }, 400));
    const err = await request(ctx(fetchImpl), {
      method: 'POST',
      path: '/x',
      endpoint: 'getQuote',
      parse: identity,
    }).catch(e => e as SwapsApiError);
    expect(err).toBeInstanceOf(SwapsApiError);
    if (!(err instanceof SwapsApiError)) throw new Error('expected a SwapsApiError');
    expect(err.code).toBe('HTTP_ERROR');
    expect(err.context.status).toBe(400);
    expect(err.context.body).toEqual({ message: 'bad request' });
    expect(fetchImpl).toHaveBeenCalledOnce(); // 400 is not retryable
  });

  it('maps invalid JSON on a 2xx to PARSE_ERROR', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 200 }));
    await expect(
      request(ctx(fetchImpl), { method: 'GET', path: '/x', endpoint: 'getTokens', parse: identity }),
    ).rejects.toMatchObject({ code: 'PARSE_ERROR' });
  });

  it('maps a parse/validation throw to VALIDATION_ERROR', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({ wrong: true }));
    const parse = () => {
      throw new Error('schema mismatch');
    };
    await expect(
      request(ctx(fetchImpl), { method: 'GET', path: '/x', endpoint: 'getQuote', parse }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('maps a thrown fetch to NETWORK_ERROR', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(
      request(ctx(fetchImpl), { method: 'GET', path: '/x', endpoint: 'getTokens', parse: identity }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('retries an idempotent call on a transient 503 then succeeds', async () => {
    const fetchImpl = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const out = await request(ctx(fetchImpl), {
      method: 'GET',
      path: '/swaps/intents/0xabc',
      endpoint: 'getIntent',
      parse: identity,
      idempotent: true,
    });
    expect(out).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget for a persistently failing idempotent call', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({}, 503));
    await expect(
      request(ctx(fetchImpl), { method: 'GET', path: '/x', endpoint: 'getStatus', parse: identity, idempotent: true }),
    ).rejects.toMatchObject({ code: 'HTTP_ERROR', context: { status: 503 } });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 + MAX_RETRIES(2)
  });

  it('never retries a non-idempotent call on a plain 503', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({}, 503));
    await expect(
      request(ctx(fetchImpl), { method: 'POST', path: '/swaps/intents', endpoint: 'createIntent', parse: identity }),
    ).rejects.toMatchObject({ code: 'HTTP_ERROR' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('never retries a non-idempotent call on a network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(
      request(ctx(fetchImpl), { method: 'POST', path: '/swaps/intents', endpoint: 'createIntent', parse: identity }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  describe('apiguard verification 503', () => {
    // Standard NestJS error body the apiguard returns when key verification is down.
    const apiGuardBody = {
      statusCode: 503,
      message: API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE,
      error: 'Service Unavailable',
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries a mutation after a backoff and succeeds', async () => {
      vi.useFakeTimers();
      const fetchImpl = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(apiGuardBody, 503))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));
      const pending = request(ctx(fetchImpl), {
        method: 'POST',
        path: '/swaps/intents',
        endpoint: 'createIntent',
        parse: identity,
      });
      // The retry backs off: nothing is replayed until the 250 ms delay elapses.
      await vi.advanceTimersByTimeAsync(249);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ ok: true });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('gives up after the retry budget when the outage persists', async () => {
      vi.useFakeTimers();
      const fetchImpl = vi.fn(async () => jsonResponse(apiGuardBody, 503));
      const pending = request(ctx(fetchImpl), {
        method: 'POST',
        path: '/swaps/submit-tx',
        endpoint: 'submitTx',
        parse: identity,
      });
      const rejection = expect(pending).rejects.toMatchObject({ code: 'HTTP_ERROR', context: { status: 503 } });
      await vi.advanceTimersByTimeAsync(250 + 500); // attempt-scaled backoffs before attempts 2 and 3
      await rejection;
      expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 + MAX_RETRIES(2)
    });

    it('surfaces TIMEOUT_ERROR when the deadline fires during the backoff sleep', async () => {
      vi.useFakeTimers();
      const fetchImpl = vi.fn(async () => jsonResponse(apiGuardBody, 503));
      const pending = request(
        { baseUrl: 'https://api.test', fetchImpl, timeout: 100 },
        { method: 'POST', path: '/swaps/intents', endpoint: 'createIntent', parse: identity },
      );
      const rejection = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT_ERROR' });
      await vi.advanceTimersByTimeAsync(100); // deadline < backoff delay: the sleep ends early, as a timeout
      await rejection;
      expect(fetchImpl).toHaveBeenCalledOnce();
    });
  });

  it('aborts the whole call as TIMEOUT_ERROR when the deadline elapses, without retrying', async () => {
    // A fetch that only settles when its signal aborts — i.e. it hangs until the timeout fires.
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    await expect(
      request(
        { baseUrl: 'https://api.test', fetchImpl, timeout: 5 },
        { method: 'GET', path: '/x', endpoint: 'getStatus', parse: identity, idempotent: true },
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT_ERROR' });
    // Timeout is an overall deadline: it stops the call rather than burning the idempotent retry budget.
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('surfaces TIMEOUT_ERROR (not PARSE_ERROR) when the deadline fires during body read', async () => {
    // Headers arrive (ok:true) but the body read hangs until the deadline aborts the signal.
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      } as unknown as Response),
    );
    await expect(
      request(
        { baseUrl: 'https://api.test', fetchImpl, timeout: 5 },
        { method: 'GET', path: '/x', endpoint: 'getTokens', parse: identity, idempotent: true },
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT_ERROR' });
    // The deadline stops the call; a timeout is never retried.
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('surfaces TIMEOUT_ERROR when the deadline fires during a non-ok body read', async () => {
    // A non-2xx response whose error-body read hangs until the deadline aborts the signal.
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      Promise.resolve({
        ok: false,
        status: 503,
        text: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      } as unknown as Response),
    );
    await expect(
      request(
        { baseUrl: 'https://api.test', fetchImpl, timeout: 5 },
        { method: 'GET', path: '/x', endpoint: 'getStatus', parse: identity, idempotent: true },
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT_ERROR' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('passes no abort signal and never times out when timeout is unset', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({ ok: true }));
    const out = await request(ctx(fetchImpl), {
      method: 'GET',
      path: '/x',
      endpoint: 'getTokens',
      parse: identity,
      idempotent: true,
    });
    expect(out).toEqual({ ok: true });
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeUndefined();
  });
});
