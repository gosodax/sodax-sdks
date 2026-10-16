/**
 * Type-guard helpers for the unified {@link SodaxError} system.
 *
 * - {@link isFeatureError} — narrows by `feature` field for cross-feature consumer code.
 * - {@link isCodeMember} — builds a per-method narrow guard from a `Set` of codes. Per-feature
 *   `errors.ts` modules use this to expose `isSupplyError`, `isCreateSwapIntentError`, etc.
 * - {@link isAuthStatus} / {@link isAuthFailure} — terminal API-key rejection, by status or by error.
 *
 * The base {@link isSodaxError} guard lives in `./SodaxError` so it ships next to the class.
 */

import type { SodaxError } from './SodaxError.js';
import { isSodaxError } from './SodaxError.js';
import type { SodaxErrorCode, SodaxFeature } from './codes.js';

/**
 * Returns a guard that narrows `unknown` to a `SodaxError` produced by a specific feature.
 *
 * @example
 *   const isSwapError = isFeatureError('swap');
 *   if (isSwapError(err)) { ... }
 */
export function isFeatureError<F extends SodaxFeature>(feature: F) {
  return (e: unknown): e is SodaxError & { feature: F } => isSodaxError(e) && e.feature === feature;
}

/**
 * Returns a guard that narrows to a `SodaxError<C>` whose code is in the given set.
 * Used by per-feature `errors.ts` modules to build per-method guards
 * (`isSupplyError`, `isCreateSwapIntentError`, etc.) without writing one function per code list.
 *
 * @example
 *   const SUPPLY_CODES = new Set([
 *     'VALIDATION_FAILED', 'INTENT_CREATION_FAILED', 'TX_VERIFICATION_FAILED',
 *     'TX_SUBMIT_FAILED', 'RELAY_TIMEOUT', 'RELAY_FAILED', 'EXECUTION_FAILED', 'UNKNOWN',
 *   ] as const satisfies SupplyErrorCode[]) as ReadonlySet<SupplyErrorCode>;
 *   export const isSupplyError = isCodeMember<SupplyErrorCode>(SUPPLY_CODES);
 */
export function isCodeMember<C extends SodaxErrorCode>(codes: ReadonlySet<C>) {
  return (e: unknown): e is SodaxError<C> => isSodaxError(e) && (codes as ReadonlySet<string>).has(e.code);
}

/**
 * True for an HTTP status that only a corrected API key can resolve: `401` (missing or invalid key)
 * and `403` (suspended organisation, or a key lacking the route's scope). The guard's `503` is
 * deliberately excluded — that one is transient and IS retried (see
 * `API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE` in `@sodax/swaps-api`).
 */
export function isAuthStatus(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

/**
 * True for a backend rejection that only a corrected API key can resolve — see {@link isAuthStatus}.
 * Terminal: callers should surface it rather than retry or keep polling.
 *
 * Reads the status the service lifted onto `context`, so it works for any `SodaxError` carrying one.
 * All `sodax.api` services lift HTTP status; the legacy solver transport retains `SolverErrorResponse`
 * and is not recognized by `isAuthFailure`.
 */
export function isAuthFailure(error: unknown): boolean {
  return isSodaxError(error) && isAuthStatus(error.context?.status);
}

export { isSodaxError } from './SodaxError.js';
