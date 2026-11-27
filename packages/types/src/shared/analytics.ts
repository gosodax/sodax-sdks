import type { SodaxFeature } from './features.js';

/** Lets a sink pair a `start` with its terminal `success` / `failure` (e.g. to measure duration or drop-off). */
export type AnalyticsEventPhase = 'start' | 'success' | 'failure';

/** `detailed` adds richer `data` payloads; the SDK only builds `detailed` events when that level is configured. */
export type AnalyticsDetailLevel = 'basic' | 'detailed';

/** `(feature, action, phase)` is the stable event identity; it matches the error layer's tagging so events line up with errors. */
export interface AnalyticsEvent {
  feature: SodaxFeature;
  /** Feature-level operation, e.g. `'supply'`, `'createIntent'`, `'stake'`. */
  action: string;
  phase: AnalyticsEventPhase;
  /** Gated against the configured level. */
  level: AnalyticsDetailLevel;
  /** Present mainly on `detailed` events. */
  data?: Record<string, unknown>;
}

/** Must be cheap and non-throwing: the SDK calls it fire-and-forget, never awaits it, and swallows its errors. */
export type AnalyticsTracker = (event: AnalyticsEvent) => void;

/** `true` tracks every action of the feature; `{ actions }` tracks only the named actions. */
export type AnalyticsFeatureScope = true | { actions: readonly string[] };

/** Allowlist: a feature omitted from the object form is OFF; the array form tracks each listed feature fully. */
export type AnalyticsFeatures = Partial<Record<SodaxFeature, AnalyticsFeatureScope>> | readonly SodaxFeature[];

/** Passing this to `new Sodax({ analytics })` turns analytics on (off by default, unlike the logger). */
export interface AnalyticsConfig {
  tracker: AnalyticsTracker;
  /** Defaults to `'basic'`. */
  level?: AnalyticsDetailLevel;
  /** Omit to track every feature and action. */
  features?: AnalyticsFeatures;
}

/** Client-side runtime option (default `false`); never fetched from or overwritten by the backend config. */
export type AnalyticsOption = AnalyticsConfig | false;
