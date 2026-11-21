import { afterEach, describe, expect, it, vi } from 'vitest';
import { pollUntil } from './pollUntil.js';
afterEach(() => vi.useRealTimers());
describe('pollUntil', () => {
  it('counts attempt duration toward the wall-clock deadline', async () => {
    vi.useFakeTimers();
    const attempt = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
      return undefined;
    });
    const result = pollUntil(attempt, { timeoutMs: 100, intervalMs: 40 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toBeUndefined();
    expect(attempt).toHaveBeenCalledTimes(2);
  });
  it('returns the first value', async () => {
    vi.useFakeTimers();
    const attempt = vi
      .fn<() => Promise<number | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(0);
    const result = pollUntil(attempt, { timeoutMs: 100, intervalMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toBe(0);
    expect(attempt).toHaveBeenCalledTimes(2);
  });
  it('attempts once with a zero timeout', async () => {
    const attempt = vi.fn(async () => undefined);
    expect(await pollUntil(attempt, { timeoutMs: 0, intervalMs: 10 })).toBeUndefined();
    expect(attempt).toHaveBeenCalledOnce();
  });
  it('propagates attempt errors', async () => {
    const error = new Error('failed');
    await expect(
      pollUntil(
        async () => {
          throw error;
        },
        { timeoutMs: 100, intervalMs: 10 },
      ),
    ).rejects.toBe(error);
  });
});
