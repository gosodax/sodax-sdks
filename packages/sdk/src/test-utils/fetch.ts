// Test-only fetch doubles. They model just the parts of `Response` the SDK's HTTP code reads.
import { type Mock, vi } from 'vitest';

/** A 200 response whose `json()` resolves to `data`. */
export const okResponse = <T>(data: T) => ({ ok: true, status: 200, json: vi.fn().mockResolvedValue(data) });

/** A non-2xx response whose `text()` resolves to `text`. */
export const httpErrorResponse = (status: number, text = '') => ({
  ok: false,
  status,
  text: vi.fn().mockResolvedValue(text),
});

/** A non-2xx response whose body is `body` serialized as JSON. */
export const jsonErrorResponse = (status: number, body: unknown) => httpErrorResponse(status, JSON.stringify(body));

/** A fetch that never settles until its signal aborts, then rejects with an `AbortError`, like the platform's. */
export const abortingFetch = <T = never>(_url: unknown, init?: { signal?: AbortSignal | null }): Promise<T> =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });

/**
 * Replaces the global `fetch` with a mock for the calling test file. The shared vitest setup unstubs globals
 * after each file, so the stub never reaches another file on the same worker.
 */
export function stubFetch(): Mock {
  const mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
  return mockFetch;
}
