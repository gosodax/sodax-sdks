import { describe, expect, it } from 'vitest';
import { BridgeApiError } from './errors.js';

describe('BridgeApiError', () => {
  it('carries code, message, and context', () => {
    const err = new BridgeApiError('HTTP_ERROR', 'boom', { status: 500, endpoint: 'getFee' });
    expect(err).toBeInstanceOf(BridgeApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('HTTP_ERROR');
    expect(err.message).toBe('boom');
    expect(err.context.status).toBe(500);
    expect(err.context.endpoint).toBe('getFee');
    expect(err.name).toBe('BridgeApiError');
  });

  it('preserves the original cause', () => {
    const cause = new Error('root');
    const err = new BridgeApiError('NETWORK_ERROR', 'wrap', {}, { cause });
    expect(err.cause).toBe(cause);
  });

  it('defaults context to an empty object', () => {
    const err = new BridgeApiError('PARSE_ERROR', 'bad json');
    expect(err.context).toEqual({});
  });
});
