import { describe, expect, it } from 'vitest';
import { mapRelayFailure } from './relay-error-mapping.js';
import { RELAY_ERROR_CODES } from '../shared/services/intentRelay/IntentRelayApiService.js';

describe('mapRelayFailure', () => {
  const ctx = { feature: 'swap', action: 'swap', srcChainKey: 'sonic', dstChainKey: 'arbitrum' } as const;

  it('maps RELAY_TIMEOUT to RELAY_TIMEOUT with phase=relay and relayCode=RELAY_TIMEOUT', () => {
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
  });

  it('maps SUBMIT_TX_FAILED to TX_SUBMIT_FAILED with phase=submit', () => {
    const inner = new Error(RELAY_ERROR_CODES.SUBMIT_TX_FAILED);
    const mapped = mapRelayFailure(inner, ctx);
    expect(mapped.code).toBe('TX_SUBMIT_FAILED');
    expect(mapped.context?.phase).toBe('submit');
    expect(mapped.context?.relayCode).toBe('SUBMIT_TX_FAILED');
  });

  it('maps RELAY_POLLING_FAILED to RELAY_FAILED with relayCode=RELAY_POLLING_FAILED', () => {
    const inner = new Error(RELAY_ERROR_CODES.RELAY_POLLING_FAILED);
    const mapped = mapRelayFailure(inner, ctx);
    expect(mapped.code).toBe('RELAY_FAILED');
    expect(mapped.context?.phase).toBe('relay');
    expect(mapped.context?.relayCode).toBe('RELAY_POLLING_FAILED');
  });

  it('falls through unrecognised relay errors to RELAY_FAILED with relayCode=UNKNOWN', () => {
    const inner = new Error('NEW_FUTURE_RELAY_ERROR');
    const mapped = mapRelayFailure(inner, ctx);
    expect(mapped.code).toBe('RELAY_FAILED');
    expect(mapped.context?.relayCode).toBe('UNKNOWN');
    expect(mapped.message).toBe('NEW_FUTURE_RELAY_ERROR');
  });

  it('handles non-Error throwables (string / number) safely', () => {
    const mapped = mapRelayFailure('weird-thing', ctx);
    expect(mapped.code).toBe('RELAY_FAILED');
    expect(mapped.context?.relayCode).toBe('UNKNOWN');
    expect(mapped.message).toBe('weird-thing');
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

  it('leaves srcTxHash out of the context when the caller does not pass it', () => {
    const mapped = mapRelayFailure(new Error(RELAY_ERROR_CODES.RELAY_TIMEOUT), ctx);
    expect(mapped.context).not.toHaveProperty('srcTxHash');
  });

  it('uses default phase=relay when phase is not overridden', () => {
    const inner = new Error(RELAY_ERROR_CODES.RELAY_TIMEOUT);
    const mapped = mapRelayFailure(inner, { feature: 'migration', action: 'migratebnUSD' });
    expect(mapped.context?.phase).toBe('relay');
  });

  it('honors phase=destinationExecution override (migration secondary watcher)', () => {
    const inner = new Error(RELAY_ERROR_CODES.RELAY_TIMEOUT);
    const mapped = mapRelayFailure(inner, {
      feature: 'migration',
      action: 'migratebnUSD',
      phase: 'destinationExecution',
    });
    expect(mapped.code).toBe('RELAY_TIMEOUT');
    expect(mapped.context?.phase).toBe('destinationExecution');
  });

  it('does not override phase=submit on TX_SUBMIT_FAILED even when destinationExecution is requested', () => {
    const inner = new Error(RELAY_ERROR_CODES.SUBMIT_TX_FAILED);
    const mapped = mapRelayFailure(inner, {
      feature: 'migration',
      action: 'migratebnUSD',
      phase: 'destinationExecution',
    });
    // SUBMIT_TX_FAILED is intrinsically a submit-phase failure regardless of caller intent.
    expect(mapped.context?.phase).toBe('submit');
  });

  it('produces empty message="Relay failed" when underlying error has no message', () => {
    const inner = new Error('');
    const mapped = mapRelayFailure(inner, ctx);
    expect(mapped.code).toBe('RELAY_FAILED');
    expect(mapped.message).toBe('Relay failed');
  });
});
