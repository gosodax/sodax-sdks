import type { SodaxError } from './SodaxError.js';
import { isSodaxError } from './SodaxError.js';
import type { SodaxErrorCode, SodaxFeature } from './codes.js';

export function isFeatureError<F extends SodaxFeature>(feature: F) {
  return (e: unknown): e is SodaxError & { feature: F } => isSodaxError(e) && e.feature === feature;
}

/** Builds per-method guards (e.g. `isSupplyError`) from a code set, for per-feature `errors.ts` modules. */
export function isCodeMember<C extends SodaxErrorCode>(codes: ReadonlySet<C>) {
  return (e: unknown): e is SodaxError<C> => isSodaxError(e) && (codes as ReadonlySet<string>).has(e.code);
}

/**
 * 401/403: only a corrected API key resolves these. The guard's 503 is excluded: it is transient and retried
 * (see `API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE` in `@sodax/swaps-api`).
 */
export function isAuthStatus(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

/**
 * Terminal (surface it, don't retry or poll), read from `context.status`. The legacy solver transport keeps
 * `SolverErrorResponse` and is not recognized.
 */
export function isAuthFailure(error: unknown): boolean {
  return isSodaxError(error) && isAuthStatus(error.context?.status);
}

export { isSodaxError } from './SodaxError.js';
