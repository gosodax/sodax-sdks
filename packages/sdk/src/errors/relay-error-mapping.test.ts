import { describe, expect, it } from 'vitest';
import { mapRelayFailure } from './relay-error-mapping.js';
import { RELAY_ERROR_CODES } from '../shared/services/intentRelay/IntentRelayApiService.js';

describe('mapRelayFailure', () => {
  const ctx = { feature: 'swap', action: 'swap', srcChainKey: 'sonic', dstChainKey: 'arbitrum' } as const;

  it('maps RELAY_TIMEOUT to RELAY_TIMEOUT with phase=relay, relayCode, caller context, and no srcTxHash unless passed', () => {
    const inner = new Error(RELAY_ERROR_CODES.RELAY_TIMEOUT);
    const mapped = mapRelayFailure(inner, ctx);
    expect(mapped.code).toBe('RELAY_TIMEOUT');
    expect(mapped.feature).toBe('swap');
    expect(mapped.message).toBe('Relay packet did not arrive within timeout');
    expect(mapped.context?.phase).toBe('relay');
    expect(mapped.context?.relayCode).toBe('RELAY_TIMEOUT');
    expect(mapped.context?.action).toBe('swap');
    expect(mapped.context?.srcChainKey).toBe('sonic');
    expect(mapped.context?.dstChainKey).toBe('arbitrum');
    expect(mapped.cause).toBe(inner);
    expect(mapped.context).not.toHaveProperty('srcTxHash');
  });

  it('maps SUBMIT_TX_FAILED to TX_SUBMIT_FAILED with phase=submit, even when destinationExecution is requested', () => {
    const mapped = mapRelayFailure(new Error(RELAY_ERROR_CODES.SUBMIT_TX_FAILED), ctx);
    expect(mapped.code).toBe('TX_SUBMIT_FAILED');
    expect(mapped.context?.phase).toBe('submit');
    expect(mapped.context?.relayCode).toBe('SUBMIT_TX_FAILED');

    // SUBMIT_TX_FAILED is intrinsically a submit-phase failure regardless of caller intent.
    const overridden = mapRelayFailure(new Error(RELAY_ERROR_CODES.SUBMIT_TX_FAILED), {
      feature: 'migration',
      action: 'migratebnUSD',
      phase: 'destinationExecution',
    });
    expect(overridden.context?.phase).toBe('submit');
  });

  it('maps RELAY_POLLING_FAILED to RELAY_FAILED with relayCode=RELAY_POLLING_FAILED', () => {
    const inner = new Error(RELAY_ERROR_CODES.RELAY_POLLING_FAILED);
    const mapped = mapRelayFailure(inner, ctx);
    expect(mapped.code).toBe('RELAY_FAILED');
    expect(mapped.context?.phase).toBe('relay');
    expect(mapped.context?.relayCode).toBe('RELAY_POLLING_FAILED');
  });

  it('falls through unrecognised, non-Error and empty-message failures to RELAY_FAILED with relayCode=UNKNOWN', () => {
    const unknown = mapRelayFailure(new Error('NEW_FUTURE_RELAY_ERROR'), ctx);
    expect(unknown.code).toBe('RELAY_FAILED');
    expect(unknown.context?.relayCode).toBe('UNKNOWN');
    expect(unknown.message).toBe('NEW_FUTURE_RELAY_ERROR');

    const thrownString = mapRelayFailure('weird-thing', ctx);
    expect(thrownString.code).toBe('RELAY_FAILED');
    expect(thrownString.context?.relayCode).toBe('UNKNOWN');
    expect(thrownString.message).toBe('weird-thing');

    const empty = mapRelayFailure(new Error(''), ctx);
    expect(empty.code).toBe('RELAY_FAILED');
    expect(empty.message).toBe('Relay failed');
  });

  it('carries srcTxHash on every mapped code when the caller passes it', () => {
    for (const message of [
      RELAY_ERROR_CODES.RELAY_TIMEOUT,
      RELAY_ERROR_CODES.SUBMIT_TX_FAILED,
      RELAY_ERROR_CODES.RELAY_POLLING_FAILED,
      'NEW_FUTURE_RELAY_ERROR',
    ]) {
      const mapped = mapRelayFailure(new Error(message), { ...ctx, srcTxHash: '0xsrc' });
      expect(mapped.context?.srcTxHash).toBe('0xsrc');
    }
  });

  it('defaults phase=relay and honors a phase=destinationExecution override (migration secondary watcher)', () => {
    const inner = new Error(RELAY_ERROR_CODES.RELAY_TIMEOUT);
    expect(mapRelayFailure(inner, { feature: 'migration', action: 'migratebnUSD' }).context?.phase).toBe('relay');

    const mapped = mapRelayFailure(inner, {
      feature: 'migration',
      action: 'migratebnUSD',
      phase: 'destinationExecution',
    });
    expect(mapped.code).toBe('RELAY_TIMEOUT');
    expect(mapped.context?.phase).toBe('destinationExecution');
  });
});
