import { RELAY_ERROR_CODES } from '../shared/services/intentRelay/IntentRelayApiService.js';
import type { SodaxErrorCode, SodaxErrorContext, SodaxFeature, SodaxPhase } from './codes.js';
import { SodaxError } from './SodaxError.js';

/** Every feature's error union includes these three codes, so the result is assignable to any of them. */
export type RelayWrappedErrorCode = Extract<SodaxErrorCode, 'RELAY_TIMEOUT' | 'TX_SUBMIT_FAILED' | 'RELAY_FAILED'>;

export type MapRelayFailureCtx = Pick<SodaxErrorContext, 'trackingId' | 'relayData' | 'hubTxHash'> & {
  feature: SodaxFeature;
  /** The feature-level operation in flight (e.g. `'supply'`, `'stake'`, `'migrateBaln'`). */
  action?: string;
  srcChainKey?: string;
  dstChainKey?: string;
  /** The original broadcast source tx, used to resume an existing operation. */
  srcTxHash?: string;
  /** Defaults to `'relay'`; `'destinationExecution'` is migration's secondary `migratebnUSD` watcher. */
  phase?: Extract<SodaxPhase, 'relay' | 'destinationExecution'>;
};

/** Matches `error.message` against {@link RELAY_ERROR_CODES}; unknown strings map to `RELAY_FAILED` with `relayCode: 'UNKNOWN'`. */
export function mapRelayFailure(error: unknown, ctx: MapRelayFailureCtx): SodaxError<RelayWrappedErrorCode> {
  const message = error instanceof Error ? error.message : String(error);
  const phase = ctx.phase ?? 'relay';
  const baseCtx = {
    action: ctx.action,
    srcChainKey: ctx.srcChainKey,
    dstChainKey: ctx.dstChainKey,
    ...(ctx.hubTxHash !== undefined && { hubTxHash: ctx.hubTxHash }),
    ...(ctx.srcTxHash !== undefined && { srcTxHash: ctx.srcTxHash }),
    ...(ctx.trackingId !== undefined && { trackingId: ctx.trackingId }),
    ...(ctx.relayData !== undefined && { relayData: ctx.relayData }),
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
