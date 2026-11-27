import { describe, expect, it } from 'vitest';
import { toResult } from './useSafeMutation.js';

describe('toResult', () => {
  it('packs a resolved promise into { ok: true, value }', async () => {
    const r = await toResult(Promise.resolve(42));
    expect(r).toEqual({ ok: true, value: 42 });
  });

  it('packs a rejected promise into { ok: false, error } — never rejects', async () => {
    const err = new Error('user rejected');
    const r = await toResult(Promise.reject(err));
    expect(r).toEqual({ ok: false, error: err });
  });

  it('preserves non-Error throwables', async () => {
    const r = await toResult(Promise.reject('boom'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('boom');
  });

  it('forwards the resolved value verbatim (no copy/transform)', async () => {
    const value = { spokeTxHash: '0xaaa', hubTxHash: '0xbbb' };
    const r = await toResult(Promise.resolve(value));
    if (r.ok) expect(r.value).toBe(value); // same reference
  });

  it('does not catch synchronous throws above the await — caller must produce a Promise', async () => {
    const wrapped = (): Promise<Result<number>> =>
      toResult(
        (async () => {
          throw new Error('async throw');
        })(),
      );
    const r = await wrapped();
    expect(r.ok).toBe(false);
  });
});

type Result<T> = { ok: true; value: T } | { ok: false; error: unknown };
