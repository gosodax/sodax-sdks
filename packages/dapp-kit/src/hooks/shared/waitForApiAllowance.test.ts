import { type RequestOverrideConfig, SodaxError } from '@sodax/sdk';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { waitForApiAllowance } from './waitForApiAllowance.js';

const valid = (value: boolean) => ({ ok: true as const, value: { valid: value } });

/** A backend failure as the API services surface it: `EXTERNAL_API_ERROR` with the status on context. */
const apiError = (status: number): SodaxError =>
  new SodaxError('EXTERNAL_API_ERROR', `responded with ${status}`, {
    feature: 'backend',
    context: { api: 'bridge', endpoint: '/bridge/allowance/check', status },
  });

const useFakeTimers = (): void => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
};

describe('waitForApiAllowance', () => {
  it('checks once when the API already sees the allowance', async () => {
    const check = vi.fn(async () => valid(true));

    await waitForApiAllowance(check, undefined, { intervalMs: 0 });

    expect(check).toHaveBeenCalledOnce();
  });

  it('re-checks a stale `valid: false` until the API catches up', async () => {
    const check = vi
      .fn()
      .mockResolvedValueOnce(valid(false))
      .mockResolvedValueOnce(valid(false))
      .mockResolvedValue(valid(true));

    await waitForApiAllowance(check, undefined, { intervalMs: 0 });

    expect(check).toHaveBeenCalledTimes(3);
  });

  it('gives up once the 15-second budget is spent', async () => {
    useFakeTimers();
    const check = vi.fn(async () => valid(false));

    const pending = waitForApiAllowance(check);
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(pending).resolves.toBeUndefined();
    // Checks at 0, 1.5s, …, 13.5s; one more pause would leave no time for a check.
    expect(check).toHaveBeenCalledTimes(10);
  });

  it('stops at the budget when a check hangs past it', async () => {
    useFakeTimers();
    const check = vi.fn(
      (_config: RequestOverrideConfig) =>
        new Promise<ReturnType<typeof valid>>(resolve => setTimeout(() => resolve(valid(true)), 30_000)),
    );
    let settled = false;

    const pending = waitForApiAllowance(check, { baseURL: 'https://api.example' }).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
    expect(check).toHaveBeenCalledOnce();
    expect(check).toHaveBeenCalledWith({ baseURL: 'https://api.example', timeout: 15_000 });
  });

  it('caps each request timeout to the time left, keeping a shorter one from the caller', async () => {
    useFakeTimers();
    const check = vi.fn(async (_config: RequestOverrideConfig) => valid(false));

    const pending = waitForApiAllowance(check, { baseURL: 'https://api.example', timeout: 14_000 });
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;

    const timeouts = check.mock.calls.map(([config]) => config.timeout);
    expect(timeouts.slice(0, 3)).toEqual([14_000, 13_500, 12_000]);
    expect(timeouts.at(-1)).toBe(1_500);
    expect(check).toHaveBeenCalledWith({ baseURL: 'https://api.example', timeout: 14_000 });
  });

  it('stops at an auth failure, which no retry fixes', async () => {
    const check = vi.fn(async () => ({ ok: false as const, error: apiError(401) }));

    await waitForApiAllowance(check, undefined, { intervalMs: 0 });

    expect(check).toHaveBeenCalledOnce();
  });

  it('retries a transient failure, which would otherwise bring the stale-allowance race back', async () => {
    const check = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: apiError(503) })
      .mockResolvedValue(valid(true));

    await waitForApiAllowance(check, undefined, { intervalMs: 0 });

    expect(check).toHaveBeenCalledTimes(2);
  });

  it('never throws: a check that rejects is retried, since the approval has already landed', async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(valid(true));

    await expect(waitForApiAllowance(check, undefined, { intervalMs: 0 })).resolves.toBeUndefined();

    expect(check).toHaveBeenCalledTimes(2);
  });

  it('waits the interval between checks', async () => {
    useFakeTimers();
    const check = vi.fn().mockResolvedValueOnce(valid(false)).mockResolvedValue(valid(true));

    const pending = waitForApiAllowance(check, undefined, { intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(999);
    expect(check).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(check).toHaveBeenCalledTimes(2);
  });
});
