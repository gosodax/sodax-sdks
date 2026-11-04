import { describe, expect, it } from 'vitest';
import { BridgeApiError } from './errors.js';
import { rejectBigint } from './serialize.js';

describe('rejectBigint', () => {
  it('throws on a stray bigint value', () => {
    expect(() => JSON.stringify({ inputAmount: 1n }, rejectBigint)).toThrowError(BridgeApiError);
  });

  it('throws on a bigint nested deep in the body', () => {
    expect(() => JSON.stringify({ bound: { accessToken: 't' }, extras: { amount: 5n } }, rejectBigint)).toThrowError(
      BridgeApiError,
    );
  });

  it('leaves a fully string-typed wire body intact', () => {
    const body = { srcChainKey: 'sonic', inputAmount: '1000000', partnerFee: { address: '0xa', percentage: 10 } };
    expect(() => JSON.stringify(body, rejectBigint)).not.toThrow();
    expect(JSON.parse(JSON.stringify(body, rejectBigint))).toEqual(body);
  });
});
