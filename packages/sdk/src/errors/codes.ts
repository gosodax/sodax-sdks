/**
 * Unified error vocabulary for the SODAX SDK.
 *
 * Every error thrown by the SDK is a {@link SodaxError} parameterised by a code from this
 * file. Codes describe the **reason** an operation failed (`RELAY_TIMEOUT`, `VALIDATION_FAILED`,
 * `EXECUTION_FAILED`), never the feature that produced it. The producing feature is carried as
 * a first-class `feature` field on the error; the operation within that feature is carried as
 * `context.action`. This split lets one logger taxonomy (Sentry/Datadog/Pino tags) cover the
 * whole SDK without per-feature special cases.
 *
 * The closed-union type `SodaxErrorCode` is the default generic of `SodaxError<C>`, so any
 * throw with an unlisted string code is a compile error — additions go through this file.
 */

import type { SodaxFeature } from '@sodax/types';

/**
 * Reason-only error codes. Each code answers "what kind of failure was this?", not
 * "which feature?".
 *
 * - `USER_REJECTED` — the connected wallet reported a user-initiated rejection of the
 *   signing / connection / approval prompt. Cancellation is a normal flow, not a failure per
 *   se — consumers branch on this code to render a "Cancelled" UI.
 * - `VALIDATION_FAILED` — a precondition / invariant tripped before any external call.
 * - `INTENT_CREATION_FAILED` — building the intent / calldata / payload failed (typically
 *   in a `create*Intent` method).
 * - `EXECUTION_FAILED` — the orchestrator-level catch-all for a multi-step operation that
 *   couldn't complete. The specific operation lives on `context.action`
 *   (`'supply' | 'borrow' | 'stake' | 'migrateBaln' | 'revertMigrateSodaToIcx' | …`).
 * - `TX_VERIFICATION_FAILED` — the spoke-side `verifyTxHash` call returned false / threw.
 * - `TX_SUBMIT_FAILED` — the spoke transaction landed but the relay POST submit failed.
 * - `RELAY_TIMEOUT` — the destination packet didn't reach `executed` within the timeout.
 * - `RELAY_FAILED` — relay polling itself failed (outage), or an unrecognised relay error.
 *   `context.relayCode` carries the underlying relay-layer code (`RELAY_POLLING_FAILED`,
 *   `'UNKNOWN'`).
 * - `APPROVE_FAILED` — ERC20 / Stellar token approval call failed.
 * - `ALLOWANCE_CHECK_FAILED` — reading on-chain allowance failed (distinct from `LOOKUP_FAILED`
 *   because retry semantics differ — allowance reads block writes).
 * - `GAS_ESTIMATION_FAILED` — gas estimation returned an error (distinct from `LOOKUP_FAILED`
 *   because retry semantics differ — re-estimation is cheap, retry-on-failure is the norm).
 * - `LOOKUP_FAILED` — any other read-only on-chain query / off-chain config fetch.
 *   `context.method` partitions this code (`'getStakingInfo'`, `'getBridgeableAmount'`, …).
 * - `EXTERNAL_API_ERROR` — an upstream API call failed (e.g. solver, backend, swaps, bridge). `context.api`
 *   identifies which service.
 * - `UNKNOWN` — last-resort catch in an outer `try`. Should be extremely rare in production.
 */
export type SodaxErrorCode =
  | 'USER_REJECTED'
  | 'VALIDATION_FAILED'
  | 'INTENT_CREATION_FAILED'
  | 'EXECUTION_FAILED'
  | 'TX_VERIFICATION_FAILED'
  | 'TX_SUBMIT_FAILED'
  | 'RELAY_TIMEOUT'
  | 'RELAY_FAILED'
  | 'APPROVE_FAILED'
  | 'ALLOWANCE_CHECK_FAILED'
  | 'GAS_ESTIMATION_FAILED'
  | 'LOOKUP_FAILED'
  | 'EXTERNAL_API_ERROR'
  | 'UNKNOWN';

/**
 * The producing feature of a SodaxError. Required at construction so consumers /
 * loggers always have a feature tag.
 *
 * Defined once in `@sodax/types` (shared with the analytics layer) and re-exported here so
 * existing `@sodax/sdk` imports of `SodaxFeature` keep working unchanged.
 */
export type { SodaxFeature };

/**
 * Orchestration phase tag attached via `context.phase`. Canonical superset across all
 * features — all features draw from this list rather than minting their own.
 *
 * - `validate` — pre-flight invariant.
 * - `intentCreation` — building the intent / payload.
 * - `verify` — spoke `verifyTxHash`.
 * - `submit` — spoke→relay submission step.
 * - `relay` — primary cross-chain wait (`relayTxAndWaitPacket`).
 * - `destinationExecution` — secondary destination watcher (used by migration's
 *   `migratebnUSD` `waitUntilIntentExecuted` call).
 * - `execution` — orchestrator-level catch-all (post-relay business logic).
 * - `postExecution` — swap-only post-relay solver step (`SwapService.postExecution`).
 * - `approve` / `allowanceCheck` / `gasEstimation` — pre-flight chain reads.
 * - `lookup` — generic read-only query.
 */
export type SodaxPhase =
  | 'validate'
  | 'intentCreation'
  | 'verify'
  | 'submit'
  | 'relay'
  | 'destinationExecution'
  | 'execution'
  | 'postExecution'
  | 'approve'
  | 'allowanceCheck'
  | 'gasEstimation'
  | 'lookup';

/**
 * Relay-layer error taxonomy mirrored on `context.relayCode` whenever an error originates
 * from {@link IntentRelayApiService}. Stable contract — see `RELAY_ERROR_CODES`.
 */
export type RelayCode = 'SUBMIT_TX_FAILED' | 'RELAY_TIMEOUT' | 'RELAY_POLLING_FAILED' | 'UNKNOWN';

/**
 * Standard `context` payload attached to {@link SodaxError}. Concrete fields vary per code.
 *
 * - `action` — the feature-level operation in flight (e.g. `'supply'`, `'stake'`,
 *   `'migrateBaln'`). Per-feature unions widen to `string` here.
 * - `phase` — orchestration phase tag.
 * - `srcChainKey` / `dstChainKey` — low-cardinality chain IDs. Suitable for logger tags.
 * - `relayCode` — set on errors whose root cause is a relay-layer failure.
 * - `api` — set on `EXTERNAL_API_ERROR`. Identifies the upstream service.
 * - `method` — set on `LOOKUP_FAILED`. Names the read-only method that failed.
 * - `status` / `nextAction` / retry fields — backend failure classification.
 * - `direction` — only set on migration's `migratebnUSD` (forward = legacy → new bnUSD;
 *   reverse = new → legacy bnUSD).
 * - `field` / `reason` — set on `VALIDATION_FAILED` to identify which precondition tripped.
 *
 * Open at the index signature so callers can attach feature-specific metadata without a
 * type extension. The serializer ({@link SodaxError.toJSON}) sanitises arbitrary values.
 */
export type SodaxErrorContext = {
  action?: string;
  phase?: SodaxPhase;
  srcChainKey?: string;
  dstChainKey?: string;
  relayCode?: RelayCode;
  api?: 'solver' | 'backend' | 'swaps' | 'leverageYield' | 'sponsoring' | 'bridge';
  method?: string;
  status?: number;
  nextAction?: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
  sponsorSequence?: string;
  direction?: 'forward' | 'reverse';
  field?: string;
  reason?: string;
  [key: string]: unknown;
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared runtime code subsets — reused by per-feature `errors.ts` for `isCodeMember` guards.
// Keeping these here (rather than redeclaring per feature) prevents drift between identical
// shapes and keeps each `errors.ts` file focused on feature-specific narrowing.
// ─────────────────────────────────────────────────────────────────────────────

export type CreateIntentErrorCode = Extract<
  SodaxErrorCode,
  'USER_REJECTED' | 'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN'
>;
export type ApproveErrorCode = Extract<
  SodaxErrorCode,
  'USER_REJECTED' | 'VALIDATION_FAILED' | 'APPROVE_FAILED' | 'UNKNOWN'
>;
export type AllowanceCheckErrorCode = Extract<
  SodaxErrorCode,
  'VALIDATION_FAILED' | 'ALLOWANCE_CHECK_FAILED' | 'UNKNOWN'
>;
export type GasEstimationErrorCode = Extract<SodaxErrorCode, 'VALIDATION_FAILED' | 'GAS_ESTIMATION_FAILED' | 'UNKNOWN'>;
export type LookupErrorCode = Extract<SodaxErrorCode, 'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'UNKNOWN'>;

/** Codes any `create*Intent` method can return. */
export const CREATE_INTENT_CODES: ReadonlySet<CreateIntentErrorCode> = new Set([
  'USER_REJECTED',
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'UNKNOWN',
]);

/** Codes any `approve` method can return. */
export const APPROVE_CODES: ReadonlySet<ApproveErrorCode> = new Set([
  'USER_REJECTED',
  'VALIDATION_FAILED',
  'APPROVE_FAILED',
  'UNKNOWN',
]);

/** Codes any `isAllowanceValid` method can return. */
export const ALLOWANCE_CHECK_CODES: ReadonlySet<AllowanceCheckErrorCode> = new Set([
  'VALIDATION_FAILED',
  'ALLOWANCE_CHECK_FAILED',
  'UNKNOWN',
]);

/** Codes any `estimateGas` method can return. */
export const GAS_ESTIMATION_CODES: ReadonlySet<GasEstimationErrorCode> = new Set([
  'VALIDATION_FAILED',
  'GAS_ESTIMATION_FAILED',
  'UNKNOWN',
]);

/** Codes any read-only lookup method can return. */
export const LOOKUP_CODES: ReadonlySet<LookupErrorCode> = new Set(['VALIDATION_FAILED', 'LOOKUP_FAILED', 'UNKNOWN']);

/** Runtime list of all valid error codes — useful for membership checks and exhaustive switches. */
export const SODAX_ERROR_CODES = [
  'USER_REJECTED',
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'EXECUTION_FAILED',
  'TX_VERIFICATION_FAILED',
  'TX_SUBMIT_FAILED',
  'RELAY_TIMEOUT',
  'RELAY_FAILED',
  'APPROVE_FAILED',
  'ALLOWANCE_CHECK_FAILED',
  'GAS_ESTIMATION_FAILED',
  'LOOKUP_FAILED',
  'EXTERNAL_API_ERROR',
  'UNKNOWN',
] as const satisfies ReadonlyArray<SodaxErrorCode>;

/** Runtime list of all valid feature tags. */
export const SODAX_FEATURES = [
  'swap',
  'moneyMarket',
  'bridge',
  'staking',
  'migration',
  'dex',
  'partner',
  'recovery',
  'backend',
  'sponsoring',
  'leverageYield',
] as const satisfies ReadonlyArray<SodaxFeature>;
