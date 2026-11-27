/**
 * `??` and destructuring defaults let NaN through (`while (elapsed < NaN)` exits at once) and Infinity never exits.
 * Internal guard: deliberately not re-exported from `shared/utils/index.ts`; import it by path.
 */
export function resolveTimeoutMs(timeout: number | undefined, fallbackMs: number): number {
  if (timeout === undefined || !Number.isFinite(timeout)) return fallbackMs;
  return Math.max(0, timeout);
}
