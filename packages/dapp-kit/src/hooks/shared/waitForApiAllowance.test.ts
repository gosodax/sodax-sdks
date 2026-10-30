import { SodaxError } from '@sodax/sdk';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { waitForApiAllowance } from './waitForApiAllowance.js';

const valid = (value: boolean) => ({ ok: true as const, value: { valid: value } });

/** A backend failure as the API services surface it: `EXTERNAL_API_ERROR` with the status on context. */
const apiError = (status: number): SodaxError =>
  new SodaxError('EXTERNAL_API_ERROR', `responded with ${status}`, {
    feature: 'backend',
    context: { api: 'bridge', endpoint: '/bridge/allowance/check', status },
  });

describe('waitForApiAllowance', () => {
  it('checks once when the API already sees the allowance', async () => {
    const check = vi.fn(async () => valid(true));

    await waitForApiAllowance(check, { intervalMs: 0 });

    expect(check).toHaveBeenCalledOnce();
  });

  it('re-checks a stale `valid: false` until the API catches up', async () => {
    const check = vi
      .fn()
      .mockResolvedValueOnce(valid(false))
      .mockResolvedValueOnce(valid(false))
      .mockResolvedValue(valid(true));

    await waitForApiAllowance(check, { intervalMs: 0 });

    expect(check).toHaveBeenCalledTimes(3);
  });

  it('gives up after the bounded number of attempts', async () => {
    const check = vi.fn(async () => valid(false));

    await waitForApiAllowance(check, { attempts: 3, intervalMs: 0 });

    expect(check).toHaveBeenCalledTimes(3);
  });

  it('stops at an auth failure, which no retry fixes', async () => {
    const check = vi.fn(async () => ({ ok: false as const, error: apiError(401) }));

    await waitForApiAllowance(check, { intervalMs: 0 });

    expect(check).toHaveBeenCalledOnce();
  });

  it('retries a transient failure, which would otherwise bring the stale-allowance race back', async () => {
    const check = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: apiError(503) })
      .mockResolvedValue(valid(true));

    await waitForApiAllowance(check, { intervalMs: 0 });

    expect(check).toHaveBeenCalledTimes(2);
  });

  it('never throws: a check that rejects is retried, since the approval has already landed', async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(valid(true));

    await expect(waitForApiAllowance(check, { intervalMs: 0 })).resolves.toBeUndefined();

    expect(check).toHaveBeenCalledTimes(2);
  });

  it('waits the interval between checks', async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const check = vi.fn().mockResolvedValueOnce(valid(false)).mockResolvedValue(valid(true));

    const pending = waitForApiAllowance(check, { intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(999);
    expect(check).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(check).toHaveBeenCalledTimes(2);
  });
});
