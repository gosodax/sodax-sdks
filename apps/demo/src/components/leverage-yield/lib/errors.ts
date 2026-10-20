import { isUserRejectedError } from '@sodax/dapp-kit';

/**
 * Error text for the UI. SDK, REST API and wallet errors nest the useful text in different places: a solver
 * refusal in `detail.message`, a REST API failure in `cause.body.message` under a SodaxError whose own message
 * is just "HTTP_REQUEST_FAILED". Read the human message wherever it is; never show a bare code.
 */

type ErrorLike = {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  cause?: unknown;
  body?: { message?: unknown; code?: unknown };
  detail?: { message?: unknown; code?: unknown };
  context?: { status?: unknown };
};

/** The error and its `cause` chain (bounded, in case of cycles). */
function chain(error: unknown): ErrorLike[] {
  const out: ErrorLike[] = [];
  let current = error;
  while (current && typeof current === 'object' && out.length < 6) {
    out.push(current as ErrorLike);
    current = (current as ErrorLike).cause;
  }
  return out;
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
/** Codes and wrappers rather than sentences: "HTTP_REQUEST_FAILED", "HTTP 422: {…}". */
const isCodeLike = (message: string) => /^[A-Z0-9_.-]+$/.test(message) || /^HTTP \d{3}\b/.test(message);

/** The most specific human-readable message in the chain: a server or solver message first, then Error text. */
export function errorMessage(error: unknown): string | undefined {
  const links = chain(error);
  const message =
    links.map(e => text(e.body?.message) ?? text(e.detail?.message)).find(Boolean) ??
    links.map(e => text(e.message)).find(m => m && !isCodeLike(m));
  // fetch() failures: Chrome "Failed to fetch", Firefox "NetworkError when…", Safari "Load failed".
  if (message && /^(failed to fetch|networkerror|load failed)/i.test(message)) {
    return "Couldn't reach the SODAX API. Check your connection and try again.";
  }
  // "getDepositQuote failed: Input amount too low" → "Input amount too low"; long wallet errors → first line.
  return message
    ?.replace(/^\w+ failed: /, '')
    .split('\n')[0]
    .slice(0, 240);
}

/** HTTP status of a failed REST API call, if the error came from one. */
export function httpStatus(error: unknown): number | undefined {
  for (const e of chain(error)) {
    const status = typeof e.status === 'number' ? e.status : e.context?.status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

/** Retry policy for API reads: a 4xx answer (other than 429) won't change on retry, so show it right away. */
export function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  const status = httpStatus(error);
  return failureCount < 2 && !(status && status >= 400 && status < 500 && status !== 429);
}

/** When there is no message to show: say what kind of failure it was. */
function fallback(error: unknown, generic: string): string {
  const status = httpStatus(error);
  if (status === 429) return 'Too many requests right now. Wait a few seconds and try again.';
  if (status && status >= 500) return `The SODAX API is having trouble (HTTP ${status}). Try again shortly.`;
  return status ? `${generic} (HTTP ${status}).` : `${generic}.`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One sentence for a failed quote (solver refusal, REST API error or SodaxError). */
export function quoteErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  if (/no route|no path|NO_PATH/i.test(message ?? '')) {
    return 'No route for this amount right now. Retrying shortly; a larger amount may work.';
  }
  if (/amount too low/i.test(message ?? '')) return 'Amount too low. Try at least ~$2.';
  if (httpStatus(error) === 429) return fallback(error, 'Quote failed');
  return message ? capitalize(message) : fallback(error, 'Quote failed');
}

/** vaultSwap codes raised before the source tx is broadcast; every other code (UNKNOWN included) may follow it. */
const NOT_BROADCAST_CODES: ReadonlySet<string> = new Set([
  'USER_REJECTED',
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
]);

/** Whether a failed vaultSwap may already have broadcast its source tx. An error without a code may have, too. */
export function mayHaveBroadcast(error: unknown): boolean {
  if (isUserRejectedError(error)) return false;
  const code = chain(error).find(e => typeof e.code === 'string')?.code;
  return typeof code !== 'string' || !NOT_BROADCAST_CODES.has(code);
}

/** One sentence for a failed deposit or withdraw step. */
export function friendlyError(error: unknown): string {
  const message = errorMessage(error) ?? '';
  // Some wallet errors reach us raw (not wrapped as a SodaxError), e.g. from API-built approvals.
  if (isUserRejectedError(error) || /user rejected|rejected the request|denied transaction/i.test(message)) {
    return 'You rejected the request in your wallet.';
  }
  if (/simulation/i.test(message)) {
    return 'The transaction would fail on-chain (simulation reverted). Check your balance or shares and try again.';
  }
  const codes = chain(error).flatMap(e => [e.code, e.body?.code]);
  if (codes.includes('RELAY_TIMEOUT')) {
    return 'This is taking longer than usual to reach Sonic. It may still complete; check the explorer link.';
  }
  if (httpStatus(error) === 429) return fallback(error, 'Something went wrong');
  if (codes.includes('INTENT_CREATION_FAILED')) {
    return `Could not create the transaction: ${message || 'unknown error'}.`.replace(/\.\.$/, '.');
  }
  return message ? capitalize(message) : fallback(error, 'Something went wrong');
}
