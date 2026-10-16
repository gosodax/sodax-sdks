import { SwapsApiError } from './errors.js';
import { rejectBigint } from './serialize.js';

type HttpMethod = 'GET' | 'POST';

/** Query value types that appear in the v2 contract. `undefined` keys are omitted from the URL. */
type QueryValue = string | number | boolean | undefined;
type QueryParams = Record<string, QueryValue>;

/** Per-client transport state, built once by `SwapsApi` from its `SwapsApiConfig`. */
export interface RequestContext {
  baseUrl: string;
  fetchImpl: typeof globalThis.fetch;
  defaultHeaders?: Record<string, string>;
  /** Overall per-call deadline (ms), enforced across all retries. Omit for no timeout. */
  timeout?: number;
}

/** Everything one endpoint call needs. `parse` validates+narrows the response (valibot lives here). */
interface RequestSpec<T> {
  method: HttpMethod;
  /** Fully-formed path with any params already `encodeURIComponent`-escaped, e.g. `/swaps/quote`. */
  path: string;
  /** `ISwapsApiV2` method name, used only for error context. */
  endpoint: string;
  query?: QueryParams;
  /** Domain body already run through `serialize.ts` (bigint fields → strings). */
  body?: unknown;
  parse: (raw: unknown) => T;
  /**
   * Idempotent/safe-to-replay calls (read GETs, polls) may be retried; mutations must not — except
   * on an apiguard 503, see {@link API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE}.
   */
  idempotent?: boolean;
}

/** Decision F: a small fixed retry budget, no backoff (kept minimal) — except apiguard-503 retries. */
const MAX_RETRIES = 2;

/** Attempts per call: the first try plus {@link MAX_RETRIES}. Which failures consume it is per failure. */
const MAX_ATTEMPTS = MAX_RETRIES + 1;

/** Transient statuses worth replaying for an idempotent call. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Backend apiguard message for a transient API-key-verification outage. A 503 carrying it was
 * rejected BEFORE the route handler ran, so replaying is safe even for mutations. Deliberately an
 * exact match against the backend apiguard contract: if the backend rewords it, the retry silently
 * stops and the error surfaces to the caller — failing safe.
 */
export const API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE = 'API key verification is temporarily unavailable';

/** Base delay for apiguard-503 retries (scaled by attempt) — the one retry case that backs off. */
const API_GUARD_RETRY_DELAY_MS = 250;

/** True for the apiguard's transient key-verification 503 (standard NestJS error body). */
function isApiGuardUnavailable(status: number, body: unknown): boolean {
  if (status !== 503 || typeof body !== 'object' || body === null) return false;
  return 'message' in body && body.message === API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE;
}

/** Resolve after `ms`, or immediately once `signal` aborts — the caller re-checks the deadline. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  // An already-aborted signal never fires `abort`, so returning early is what keeps a doomed call
  // from waiting out the full delay before the caller re-checks its deadline.
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const done = (): void => {
      signal?.removeEventListener('abort', done); // `{ once: true }` only covers the abort path
      clearTimeout(id);
      resolve();
    };
    const id = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Canonical (lower-case) name of the API-key header the backend apiguard reads. */
const API_KEY_HEADER = 'x-api-key';

/**
 * The `x-api-key` header for an `apiKey` config option, or nothing when it is unset. An empty string
 * counts as unset — a set-but-empty env var must fall back rather than send a blank credential.
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
 * Kept in step with the identical helper in `@sodax/sdk`'s `backendApi/api-utils.ts` — this package
 * cannot import from the SDK, and the SDK's copy also serves its non-swaps services.
 */
export function mergeHeaders(...sources: Array<Record<string, string> | undefined>): Record<string, string> {
  const byName = new Map<string, [name: string, value: string]>();
  for (const source of sources) {
    for (const entry of Object.entries(source ?? {})) byName.set(entry[0].toLowerCase(), entry);
  }
  return Object.fromEntries(byName.values());
}

/** Serialize a query object: `boolean`/`number` → string, `undefined` omitted. Returns `''` or `?a=b`. */
export function buildQuery(query: QueryParams | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

/** Join `baseUrl` + `path` + query. `path` is expected to be pre-encoded by the caller. */
export function buildUrl(baseUrl: string, path: string, query?: QueryParams): string {
  // Linear trailing-slash trim (avoids a polynomial `/\/+$/` regex over library-supplied input).
  let end = baseUrl.length;
  while (end > 0 && baseUrl.codePointAt(end - 1) === 47 /* '/' */) end--;
  const base = baseUrl.slice(0, end);
  const rel = path.startsWith('/') ? path : `/${path}`;
  return `${base}${rel}${buildQuery(query)}`;
}

async function readBodySafe(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => undefined);
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text; // not JSON — surface the raw text so the backend message isn't lost.
  }
}

/**
 * Perform one endpoint call: build the URL, send via the injected `fetch`, and on success parse +
 * validate the JSON. Always throws {@link SwapsApiError} on failure (per the throwing contract).
 * Retries idempotent calls on transient statuses / network errors, and any call on the apiguard 503.
 * When `ctx.timeout` is set, a single `AbortController` bounds the WHOLE call (all retries) — a hard
 * latency ceiling — and its expiry surfaces as `TIMEOUT_ERROR` without consuming the retry budget.
 */
export async function request<T>(ctx: RequestContext, spec: RequestSpec<T>): Promise<T> {
  const url = buildUrl(ctx.baseUrl, spec.path, spec.query);
  const context = { endpoint: spec.endpoint, method: spec.method, path: spec.path };

  // Case-insensitive merge, so a caller-supplied `content-type` is replaced rather than sent alongside
  // ours (which `fetch` would fold into one comma-joined value).
  const headers = mergeHeaders(
    ctx.defaultHeaders,
    spec.body === undefined ? undefined : { 'Content-Type': 'application/json' },
  );
  let bodyText: string | undefined;
  if (spec.body !== undefined) {
    // rejectBigint throws if a bigint slipped past serialize.ts — fail loud, never silently coerce.
    bodyText = JSON.stringify(spec.body, rejectBigint);
  }

  // One deadline for the whole call (shared across retries), so `timeout` is a hard ceiling on total
  // latency rather than a per-attempt window. No `timeout` → no controller, no abort.
  const controller = ctx.timeout === undefined ? undefined : new AbortController();
  const timeoutId = controller ? setTimeout(() => controller.abort(), ctx.timeout) : undefined;
  // Our deadline fired mid-flight: any in-progress await rejects, so classify as TIMEOUT_ERROR
  // regardless of which await caught it (signal.aborted is true only when OUR controller aborted).
  const timedOut = (): boolean => controller?.signal.aborted === true;
  const timeoutError = (cause?: unknown): SwapsApiError =>
    new SwapsApiError('TIMEOUT_ERROR', `${spec.endpoint} timed out after ${ctx.timeout}ms`, context, { cause });

  let lastError: SwapsApiError | undefined;

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let response: Response;
      try {
        response = await ctx.fetchImpl(url, {
          method: spec.method,
          headers,
          body: bodyText,
          signal: controller?.signal,
        });
      } catch (cause) {
        // Our deadline fired: surface a distinct TIMEOUT_ERROR and stop. The budget is spent, and the
        // already-tripped signal would abort every remaining attempt instantly anyway.
        if (timedOut()) throw timeoutError(cause);
        lastError = new SwapsApiError('NETWORK_ERROR', `Request to ${spec.endpoint} failed`, context, { cause });
        // A mutation's request may have reached the server before the failure, so never replay it here.
        if (spec.idempotent && attempt < MAX_ATTEMPTS) continue;
        throw lastError;
      }

      if (!response.ok) {
        const body = await readBodySafe(response);
        // A deadline that fired during the (best-effort) error-body read is still a timeout, not an
        // HTTP error — and must stop the call rather than fall through to the retry check below.
        if (timedOut()) throw timeoutError();
        lastError = new SwapsApiError('HTTP_ERROR', `${spec.endpoint} responded with ${response.status}`, {
          ...context,
          status: response.status,
          body,
        });
        if (attempt < MAX_ATTEMPTS) {
          // Replay-safe for mutations too, and the one retry that backs off. The deadline still bounds
          // the sleep via the shared signal.
          if (isApiGuardUnavailable(response.status, body)) {
            await sleep(API_GUARD_RETRY_DELAY_MS * attempt, controller?.signal);
            if (timedOut()) throw timeoutError();
            continue;
          }
          if (spec.idempotent && RETRYABLE_STATUS.has(response.status)) continue;
        }
        throw lastError;
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch (cause) {
        // The deadline can fire mid-body-read: a rejected json() with the signal aborted is a timeout,
        // not a malformed body.
        if (timedOut()) throw timeoutError(cause);
        throw new SwapsApiError('PARSE_ERROR', `${spec.endpoint} returned a non-JSON body`, context, { cause });
      }

      try {
        return spec.parse(raw);
      } catch (cause) {
        throw new SwapsApiError('VALIDATION_ERROR', `${spec.endpoint} response failed validation`, {
          ...context,
          issues: cause,
        });
      }
    }

    // Unreachable (maxAttempts >= 1), but keeps the function total for the type checker.
    throw lastError ?? new SwapsApiError('NETWORK_ERROR', `${spec.endpoint} failed`, context);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
