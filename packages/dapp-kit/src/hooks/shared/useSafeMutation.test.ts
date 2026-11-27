import { describe, expect, it } from 'vitest';
import { toResult } from './useSafeMutation.js';

describe('toResult', () => {
  it('packs a resolved promise into { ok: true, value }, forwarding the value verbatim', async () => {
    const value = { spokeTxHash: '0xaaa', hubTxHash: '0xbbb' };
    const r = await toResult(Promise.resolve(value));
    expect(r).toEqual({ ok: true, value });
    if (r.ok) expect(r.value).toBe(value);
  });

  it('packs a rejected promise into { ok: false, error } — never rejects, and keeps non-Error throwables', async () => {
    const err = new Error('user rejected');
    expect(await toResult(Promise.reject(err))).toEqual({ ok: false, error: err });
    expect(await toResult(Promise.reject('boom'))).toEqual({ ok: false, error: 'boom' });
  });
});
