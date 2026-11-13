import type { SodaxFeature } from './features.js';

/**
 * Analytics for the SDK — structured, opt-in tracking of user-action flows.
 *
 * This is deliberately separate from {@link SodaxLogger}. The logger is a developer-facing
 * diagnostics sink that is **on by default** (`console`) and takes free-form messages. Analytics
 * is a product-facing event stream that is **off by default**: the SDK emits nothing — and never
 * even builds an event payload — unless a consumer explicitly enables it via
 * `new Sodax({ analytics })`. This keeps feature code paths free of analytics overhead when it is
 * not in use.
 *
 * Enable and shape it through {@link AnalyticsOption} on the `Sodax` constructor:
 * - omitted / `false` — disabled (default).
 * - an {@link AnalyticsConfig} — forward events to your own product-analytics backend, optionally
 *   scoped by feature and detail level.
 */

/**
 * Lifecycle phase of a tracked feature action flow. Every event marks where in a feature's action
 * flow it was emitted, so a sink can pair a `start` with its terminal `success` / `failure`
 * (e.g. to measure duration or drop-off).
 */
export type AnalyticsEventPhase = 'start' | 'success' | 'failure';

/**
 * Detail level an event belongs to. Consumers choose how much the SDK tracks:
 * - `basic` — coarse action flow (feature, action, phase) only.
 * - `detailed` — adds richer `data` payloads (amounts, tokens, chain keys, …).
 *
 * The SDK only builds and emits a `detailed` event when the configured level is `detailed`, so
 * heavier payloads are never constructed when a consumer stays on `basic`.
 */
export type AnalyticsDetailLevel = 'basic' | 'detailed';

/**
 * A single user-action analytics event emitted by the SDK at a feature action-flow boundary.
 *
 * `feature` + `action` + `phase` form the stable identity of an event — the same `(feature,
 * action)` tagging the error layer already standardizes — so events line up with errors in a
 * downstream sink. `data` is an optional structured payload whose richness depends on the
 * configured {@link AnalyticsDetailLevel}.
 */
export interface AnalyticsEvent {
  /** The high-level feature the action belongs to. */
  feature: SodaxFeature;
  /** The feature-level operation in flight, e.g. `'supply'`, `'createIntent'`, `'stake'`. */
  action: string;
  /** Where in the action flow this event was emitted. */
  phase: AnalyticsEventPhase;
  /** The detail level this event belongs to; gated against the configured level. */
  level: AnalyticsDetailLevel;
  /** Optional structured payload. Present mainly on `detailed` events. */
  data?: Record<string, unknown>;
}

/**
 * Consumer-supplied tracker: the SDK calls it once per emitted event, and the consumer forwards the
 * event to their product-analytics backend (Segment, Amplitude, PostHog, a custom collector, …),
 * e.g. `tracker: (event) => amplitude.track(event.action, event.data)`.
 *
 * It should be cheap — the SDK treats it as fire-and-forget and does not await it. Any error it throws
 * is swallowed, and if it returns a promise (an `async` tracker) a rejection of that promise is
 * absorbed too, so analytics can never break a feature flow or raise an unhandled rejection.
 */
export type AnalyticsTracker = (event: AnalyticsEvent) => void;

/**
 * How much of one feature to track, in the {@link AnalyticsConfig.features} allowlist:
 * - `true` — every action of the feature.
 * - `{ actions }` — only the named actions (e.g. `{ actions: ['supply', 'borrow'] }`).
 */
export type AnalyticsFeatureScope = true | { actions: readonly string[] };

/**
 * The set of features (and actions) to track — an **allowlist**. Two equivalent forms:
 * - Object: per-feature {@link AnalyticsFeatureScope}. A feature **omitted from the object is OFF**.
 *   `{ swap: true, moneyMarket: { actions: ['supply'] } }`.
 * - Array shorthand: a list of features, each fully tracked. `['swap', 'moneyMarket']`.
 *
 * Omitting {@link AnalyticsConfig.features} entirely tracks **everything** (all features, all
 * actions) — scoping is opt-in.
 */
export type AnalyticsFeatures = Partial<Record<SodaxFeature, AnalyticsFeatureScope>> | readonly SodaxFeature[];

/**
 * Analytics configuration passed to `new Sodax({ analytics })`.
 *
 * Providing this object is what turns analytics on; the {@link AnalyticsTracker} `tracker` is the
 * only required field. `level` and `features` narrow what gets emitted so consumers track only what
 * they care about — by detail level and by feature/action.
 *
 * @example
 * new Sodax({
 *   analytics: {
 *     tracker: (event) => amplitude.track(event.action, event.data),
 *     features: {
 *       swap: true,                              // all swap actions
 *       moneyMarket: { actions: ['supply', 'borrow'] }, // only these
 *       // staking omitted → OFF
 *     }, // or simple form: features: ['swap', 'moneyMarket']
 *   },
 * });
 */
export interface AnalyticsConfig {
  /** Where events are delivered. Required — enabling analytics means supplying a tracker. */
  tracker: AnalyticsTracker;
  /**
   * Highest detail level to emit. Defaults to `'basic'`. Events tagged `'detailed'` are only built
   * and delivered when this is `'detailed'`.
   */
  level?: AnalyticsDetailLevel;
  /**
   * Allowlist of features/actions to track. Omit to track everything; otherwise only the listed
   * features (and, with `{ actions }`, only the listed actions) emit. See {@link AnalyticsFeatures}.
   */
  features?: AnalyticsFeatures;
}

/**
 * The `analytics` option accepted by `new Sodax(...)`. Either a full {@link AnalyticsConfig} or
 * `false` (the default — analytics disabled).
 *
 * Like `logger`, this is a client-side runtime option resolved once by the SDK; it is never
 * fetched from or overwritten by the backend config.
 */
export type AnalyticsOption = AnalyticsConfig | false;
