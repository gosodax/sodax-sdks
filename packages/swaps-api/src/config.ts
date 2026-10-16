/** Configuration for a `SwapsApi` client instance. */
export interface SwapsApiConfig {
  /**
   * Base URL of the Swaps API host, including any version prefix. The package never hardcodes
   * environment URLs. Example: `https://canary-api.sodax.com/v1`.
   */
  baseUrl: string;
  /**
   * Overall per-call deadline in milliseconds, enforced with an `AbortController` across the entire
   * call INCLUDING retries — a hard ceiling on total latency, not a per-attempt window. Omit for no
   * timeout. On expiry the call rejects with a `SwapsApiError` whose `code` is `TIMEOUT_ERROR`.
   */
  timeout?: number;
  /**
   * `fetch` implementation to use. Defaults to the global `fetch`. Inject a custom one for tests or
   * non-standard runtimes. It receives the timeout `AbortSignal` (when `timeout` is set), so a custom
   * fetch should forward `init.signal`.
   */
  fetch?: typeof globalThis.fetch;
  /** Extra headers merged over the defaults on every request. */
  headers?: Record<string, string>;
  /**
   * API key sent as the `x-api-key` header on every request (the backend guards `POST /swaps/*`
   * routes with it). An explicit `headers['x-api-key']` wins over this convenience option. For a
   * different key per call, construct another client — instances are cheap and stateless.
   */
  apiKey?: string;
}
