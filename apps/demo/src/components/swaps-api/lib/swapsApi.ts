import { SwapsApi, SwapsApiError } from '@sodax/swaps-api';
import { DEFAULT_BACKEND_API_TIMEOUT, isAuthStatus } from '@sodax/dapp-kit';
import { useMemo } from 'react';
import { effectiveSodaxApiKey, effectiveSwapsApiBaseUrl } from '@/lib/sodaxSettings';
import { formatMutationFailureMessage } from '@/lib/utils';
import { useAppStore } from '@/zustand/useAppStore';

/**
 * Direct `@sodax/swaps-api` client for this page. Unlike the rest of the demo (which reaches the
 * swaps backend through `sodax.api.swaps` / dapp-kit hooks), this page drives the original wire
 * client itself — dapp-kit stays involved only for wallet/signing and chain-prerequisite concerns
 * the API doesn't cover.
 *
 * Base URL and key come from the same effective settings the provider hands the SDK, because the
 * page's order-status panel polls through `sodax.api.swaps`: a client configured on its own would
 * submit to one deployment and poll another, leaving every order pending. A hook rather than a
 * module singleton because the Sodax Settings modal changes both at runtime.
 *
 * `timeout` is not optional in practice: the package omits it by default, meaning no deadline at
 * all, so a stalled request would hang a quote or the swap dialog with nothing to recover from.
 * The SDK path applies `DEFAULT_BACKEND_API_TIMEOUT` — reused here rather than restated.
 */
export function useSwapsApiClient(): SwapsApi {
  const { sodaxSettings } = useAppStore();
  const baseUrl = effectiveSwapsApiBaseUrl(sodaxSettings);
  const apiKey = effectiveSodaxApiKey(sodaxSettings);

  return useMemo(
    () => new SwapsApi({ baseUrl, timeout: DEFAULT_BACKEND_API_TIMEOUT, ...(apiKey ? { apiKey } : {}) }),
    [baseUrl, apiKey],
  );
}

/**
 * The backend's explanation, when the error body carries one. `context.body` is `unknown` by
 * contract — parsed JSON on a good day, response text otherwise — so `message` is only used once
 * it proves to be a non-blank string; anything else (an object, an array, a bare text body) would
 * render as "[object Object]" or dump a whole error page into the dialog.
 */
function backendMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('message' in body)) return undefined;
  const { message } = body;
  return typeof message === 'string' && message.trim().length > 0 ? message : undefined;
}

/**
 * Human-readable text for a failed swaps-api call. A `SwapsApiError`'s own message is generic
 * ("createIntent responded with 400"), so the backend's explanation wins when there is one.
 * Everything else — a malformed body, a network or validation failure, a signing or wallet error —
 * goes to the shared formatter, which also surfaces the `cause`.
 */
export function formatSwapsApiError(error: unknown, fallback: string): string {
  const fromBackend = error instanceof SwapsApiError ? backendMessage(error.context.body) : undefined;
  return fromBackend ?? formatMutationFailureMessage(error, fallback);
}

/**
 * React Query `retry` for the direct client, mirroring dapp-kit's `retryUnlessAuthFailure`: replay a
 * transport blip, never a terminal API-key rejection. It cannot reuse that helper — `isAuthFailure`
 * is gated on `isSodaxError`, and a `SwapsApiError` only becomes one after passing through
 * `SwapsApiService`, which this page bypasses by design.
 *
 * `error` is typed `Error` rather than `unknown` to match React Query's default `TError` (`Error`),
 * so `query.error` stays a renderable `Error`; `unknown` here would only widen it needlessly.
 */
export const retryUnlessSwapsApiAuthFailure = (failureCount: number, error: Error): boolean =>
  !(error instanceof SwapsApiError && isAuthStatus(error.context.status)) && failureCount < 3;
