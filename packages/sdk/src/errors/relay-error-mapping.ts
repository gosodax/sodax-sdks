/**
 * Maps a relay-layer failure into a unified {@link SodaxError}.
 *
 * The relay layer ({@link IntentRelayApiService}) emits a small, stable set of error
 * messages ({@link RELAY_ERROR_CODES}); this mapper translates each one to the appropriate
 * code and sets `context.relayCode` so consumers can branch without parsing `cause.message`.
 *
 * Future relay error strings (not in {@link RELAY_ERROR_CODES}) fall through to
 * `RELAY_FAILED` with `relayCode: 'UNKNOWN'` so consumers' switches stay exhaustive.
 */

import { RELAY_ERROR_CODES } from '../shared/services/intentRelay/IntentRelayApiService.js';
import type { SodaxErrorCode, SodaxFeature, SodaxPhase } from './codes.js';
import { SodaxError } from './SodaxError.js';

/**
 * The subset of {@link SodaxErrorCode} that {@link mapRelayFailure} can produce.
 * This is `RELAY_TIMEOUT | TX_SUBMIT_FAILED | RELAY_FAILED` — narrow enough that the result
 * is structurally assignable to any feature's `SodaxError<FeatureErrorCode>` (since every
 * feature's union includes all three relay codes).
 */
export type RelayWrappedErrorCode = Extract<SodaxErrorCode, 'RELAY_TIMEOUT' | 'TX_SUBMIT_FAILED' | 'RELAY_FAILED'>;

export type MapRelayFailureCtx = {
  /** The producing feature. Required so the mapped error carries a feature tag. */
  feature: SodaxFeature;
  /** The feature-level operation in flight (e.g. `'supply'`, `'stake'`, `'migrateBaln'`). */
  action?: string;
  srcChainKey?: string;
  dstChainKey?: string;
  /** The broadcast source tx, so a caller can keep reading status after a post-broadcast failure. */
  srcTxHash?: string;
  /**
   * Phase override. Defaults to `'relay'`. Set to `'destinationExecution'` for migration's
   * secondary `waitUntilIntentExecuted` watcher (`migratebnUSD`) where the failure is
   * downstream of the primary relay.
   */
  phase?: Extract<SodaxPhase, 'relay' | 'destinationExecution'>;
};

/**
 * Maps a relay-layer failure into a unified {@link SodaxError}.
 *
 * @param error - The error returned by `relayTxAndWaitPacket` / `submitTransaction`. Its
 *   `message` field is matched against {@link RELAY_ERROR_CODES} for taxonomy lookup.
 * @param ctx - Producing feature, action, chain identifiers, optional phase override.
 */
export function mapRelayFailure(error: unknown, ctx: MapRelayFailureCtx): SodaxError<RelayWrappedErrorCode> {
  const message = error instanceof Error ? error.message : String(error);
  const phase = ctx.phase ?? 'relay';
  const baseCtx = {
    action: ctx.action,
    srcChainKey: ctx.srcChainKey,
    dstChainKey: ctx.dstChainKey,
    ...(ctx.srcTxHash !== undefined && { srcTxHash: ctx.srcTxHash }),
  };

  if (message === RELAY_ERROR_CODES.RELAY_TIMEOUT) {
    return new SodaxError<RelayWrappedErrorCode>('RELAY_TIMEOUT', 'Relay packet did not arrive within timeout', {
      feature: ctx.feature,
      cause: error,
      context: { ...baseCtx, phase, relayCode: 'RELAY_TIMEOUT' },
    });
  }

  if (message === RELAY_ERROR_CODES.SUBMIT_TX_FAILED) {
    return new SodaxError<RelayWrappedErrorCode>('TX_SUBMIT_FAILED', 'Relay submission failed after spoke tx landed', {
      feature: ctx.feature,
      cause: error,
      context: { ...baseCtx, phase: 'submit', relayCode: 'SUBMIT_TX_FAILED' },
    });
  }

  if (message === RELAY_ERROR_CODES.RELAY_POLLING_FAILED) {
    return new SodaxError<RelayWrappedErrorCode>(
      'RELAY_FAILED',
      'Relay polling failed; cannot determine packet status',
      {
        feature: ctx.feature,
        cause: error,
        context: { ...baseCtx, phase, relayCode: 'RELAY_POLLING_FAILED' },
      },
    );
  }

  return new SodaxError<RelayWrappedErrorCode>('RELAY_FAILED', message || 'Relay failed', {
    feature: ctx.feature,
    cause: error,
    context: { ...baseCtx, phase, relayCode: 'UNKNOWN' },
  });
}
