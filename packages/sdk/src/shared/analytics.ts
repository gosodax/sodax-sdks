import type {
  AnalyticsDetailLevel,
  AnalyticsEventPhase,
  AnalyticsFeatures,
  AnalyticsOption,
  Result,
  SodaxFeature,
} from '@sodax/types';

/** Lazy per-phase payload builders, invoked only if their event actually emits. */
export interface AnalyticsActionData<T, E> {
  start?: () => Record<string, unknown>;
  success?: (value: T) => Record<string, unknown>;
  failure?: (error: E) => Record<string, unknown>;
}

/** Resolved once and held on `ConfigService`; `build` thunks never run when an event is gated off, so disabled analytics costs nothing. */
export interface ResolvedAnalytics {
  /** For when even deciding what to emit is costly; {@link emit} checks it internally. Omit `action` for the feature. */
  isEnabled(feature: SodaxFeature, action?: string, level?: AnalyticsDetailLevel): boolean;
  /** `build` runs only if the event passes the gate; delivery is fire-and-forget so a faulty tracker can't break a flow. */
  emit(
    feature: SodaxFeature,
    action: string,
    phase: AnalyticsEventPhase,
    build?: () => Record<string, unknown>,
    level?: AnalyticsDetailLevel,
  ): void;
  /** Emits `start`, then `success`/`failure` from the `Result` (or `failure` + rethrow), returning the `Result` unchanged. */
  trackResult<T, E>(
    feature: SodaxFeature,
    action: string,
    run: () => Promise<Result<T, E>>,
    data?: AnalyticsActionData<T, E>,
  ): Promise<Result<T, E>>;
}

export const noopAnalytics: ResolvedAnalytics = {
  isEnabled: () => false,
  emit: () => {},
  trackResult: (_feature, _action, run) => run(),
};

/** Detail levels ordered low → high so a configured `basic` excludes `detailed` events. */
const LEVEL_RANK: Record<AnalyticsDetailLevel, number> = { basic: 0, detailed: 1 };

/** `null` = no scoping (track all); a `Map` entry `true` = all actions, a `Set` = only those; absent features are OFF. */
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

/** Off unless the consumer opts in (unlike `resolveLogger`, which is on by default). */
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
      tracker({ feature, action, phase, level, data: build?.() });
    } catch {
      // A throwing consumer tracker must never break a feature flow.
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
      // Still record a failure, then rethrow so the caller's error handling is unchanged.
      emit(feature, action, 'failure', () => ({ error: error instanceof Error ? error.message : String(error) }));
      throw error;
    }
  };

  return { isEnabled, emit, trackResult };
}
