import type {
  AnalyticsDetailLevel,
  AnalyticsEventPhase,
  AnalyticsFeatures,
  AnalyticsOption,
  Result,
  SodaxFeature,
} from '@sodax/types';

/**
 * Optional per-phase payload builders for {@link ResolvedAnalytics.trackResult}. Each is a lazy thunk
 * invoked only if its event actually emits, so payloads are never built when analytics is off.
 * `success` receives the resolved value, `failure` the `Result` error.
 */
export interface AnalyticsActionData<T, E> {
  start?: () => Record<string, unknown>;
  success?: (value: T) => Record<string, unknown>;
  failure?: (error: E) => Record<string, unknown>;
}

/**
 * The SDK-internal analytics emitter, resolved once from the consumer's {@link AnalyticsOption} and
 * held on `ConfigService` (`config.analytics`).
 *
 * Services never touch the raw config — they call {@link ResolvedAnalytics.emit}, which is the only
 * gate. When analytics is disabled, off for a feature/action, or above the configured detail level,
 * the `build` thunk is never invoked, so event payloads are never constructed on hot feature paths.
 * This is what keeps feature code free of analytics overhead unless a consumer explicitly opts in.
 */
export interface ResolvedAnalytics {
  /**
   * Whether an event for `feature`/`action` at `level` would be emitted. Call sites rarely need this
   * directly — {@link emit} checks it internally — but it is exposed for the rare case where even
   * deciding what to emit is itself costly. Omit `action` to ask whether the feature is tracked at all.
   */
  isEnabled(feature: SodaxFeature, action?: string, level?: AnalyticsDetailLevel): boolean;
  /**
   * Emit one user-action event. `build` produces the optional structured payload and is invoked
   * lazily — only when the event passes the enabled/feature/action/level gate — so disabled analytics
   * costs nothing but a boolean check at the call site. A faulty consumer tracker can never break a
   * feature flow: delivery is wrapped and fire-and-forget.
   */
  emit(
    feature: SodaxFeature,
    action: string,
    phase: AnalyticsEventPhase,
    build?: () => Record<string, unknown>,
    level?: AnalyticsDetailLevel,
  ): void;
  /**
   * Wrap a `Result`-returning action flow: emit `start` before `run`, then `success` or `failure`
   * from the resolved `Result` (and `failure` + rethrow if `run` throws), returning the `Result`
   * unchanged. This is the canonical way to instrument a feature method — one call at the boundary
   * covers every internal return point, so action code stays free of scattered emit calls.
   */
  trackResult<T, E>(
    feature: SodaxFeature,
    action: string,
    run: () => Promise<Result<T, E>>,
    data?: AnalyticsActionData<T, E>,
  ): Promise<Result<T, E>>;
}

/** Disabled emitter: every gate is closed, `build` is never called, nothing is delivered. */
export const noopAnalytics: ResolvedAnalytics = {
  isEnabled: () => false,
  emit: () => {},
  trackResult: (_feature, _action, run) => run(),
};

/** Detail levels ordered low → high so a configured `basic` excludes `detailed` events. */
const LEVEL_RANK: Record<AnalyticsDetailLevel, number> = { basic: 0, detailed: 1 };

/**
 * Normalize the {@link AnalyticsFeatures} allowlist into a fast lookup:
 * - `null` → no scoping configured: every feature/action is tracked.
 * - `Map` entry `true` → track all of that feature's actions.
 * - `Map` entry `Set` → track only those actions.
 *
 * A feature absent from the map is OFF (allowlist semantics). The array shorthand maps each listed
 * feature to `true` (all actions).
 */
function normalizeFeatures(features: AnalyticsFeatures | undefined): Map<SodaxFeature, true | Set<string>> | null {
  if (features === undefined) return null;
  const map = new Map<SodaxFeature, true | Set<string>>();
  if (Array.isArray(features)) {
    for (const feature of features as readonly SodaxFeature[]) map.set(feature, true);
  } else {
    for (const [feature, scope] of Object.entries(features) as [
      SodaxFeature,
      true | { actions: readonly string[] },
    ][]) {
      if (scope === true) map.set(feature, true);
      else if (scope) map.set(feature, new Set(scope.actions));
    }
  }
  return map;
}

/**
 * Resolve an {@link AnalyticsOption} (a config object, `false`, or `undefined`) into a concrete
 * {@link ResolvedAnalytics}.
 *
 * Defaults to {@link noopAnalytics} so analytics is **off** unless a consumer opts in with an
 * `AnalyticsConfig`. This mirrors `resolveLogger` but with the opposite default — logging is on by
 * default, analytics is off — per issue #175 ("no needless invocations unless explicitly enabled").
 */
export function resolveAnalytics(option: AnalyticsOption | undefined): ResolvedAnalytics {
  if (!option) return noopAnalytics; // undefined | false → disabled
  const { tracker, level: configuredLevel = 'basic', features } = option;
  const maxRank = LEVEL_RANK[configuredLevel];
  const allow = normalizeFeatures(features);

  const isEnabled = (feature: SodaxFeature, action?: string, level: AnalyticsDetailLevel = 'basic'): boolean => {
    if (LEVEL_RANK[level] > maxRank) return false; // event is more detailed than the configured level
    if (allow === null) return true; // no scoping → track everything
    const scope = allow.get(feature);
    if (scope === undefined) return false; // feature not in the allowlist
    if (scope === true) return true; // all actions of the feature
    if (action === undefined) return scope.size > 0; // feature-level check: any action tracked?
    return scope.has(action); // action-scoped allowlist
  };

  const emit: ResolvedAnalytics['emit'] = (feature, action, phase, build, level = 'basic') => {
    if (!isEnabled(feature, action, level)) return;
    try {
      // `AnalyticsTracker` returns `void`, but TypeScript lets an `async` function satisfy that, so the
      // tracker may hand back a promise. Its rejection lands after `emit` returns, outside this `catch`,
      // and an unhandled rejection terminates a Node process — so absorb it here too.
      const returned: unknown = tracker({ feature, action, phase, level, data: build?.() });
      if (typeof (returned as PromiseLike<unknown> | undefined)?.then === 'function') {
        Promise.resolve(returned).catch(() => {});
      }
    } catch {
      // Analytics is fire-and-forget — a throwing consumer tracker must never break a feature flow.
    }
  };

  const trackResult: ResolvedAnalytics['trackResult'] = async (feature, action, run, data) => {
    emit(feature, action, 'start', data?.start);
    try {
      const result = await run();
      if (result.ok) {
        const build = data?.success;
        emit(feature, action, 'success', build ? () => build(result.value) : undefined);
      } else {
        const build = data?.failure;
        emit(feature, action, 'failure', build ? () => build(result.error) : undefined);
      }
      return result;
    } catch (error) {
      // `run` threw rather than returning a `Result` error — still record a failure, then rethrow so
      // the caller's own error handling is unchanged.
      emit(feature, action, 'failure', () => ({ error: error instanceof Error ? error.message : String(error) }));
      throw error;
    }
  };

  return { isEnabled, emit, trackResult };
}
