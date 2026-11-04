import { afterEach, describe, expect, it, vi } from 'vitest';
import { withDeadline } from './withDeadline.js';

const timedOut = () => new Error('timed out');

afterEach(() => vi.useRealTimers());

describe('withDeadline', () => {
  it('settles with the promise when it wins, and releases its timer', async () => {
    vi.useFakeTimers();
    await expect(withDeadline(Promise.resolve('ok'), 1_000, timedOut)).resolves.toBe('ok');
    await expect(withDeadline(Promise.reject(new Error('boom')), 1_000, timedOut)).rejects.toThrow('boom');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with onTimeout once the deadline passes', async () => {
    vi.useFakeTimers();
    const racing = withDeadline(new Promise(() => {}), 1_000, timedOut);
    const assertion = expect(racing).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it('rejects with onAbort when the signal aborts first, and releases its timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const racing = withDeadline(
      new Promise(() => {}),
      1_000,
      timedOut,
      controller.signal,
      () => new Error('cancelled'),
    );
    controller.abort();
    await expect(racing).rejects.toThrow('cancelled');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects at once for a signal that is already aborted, with its reason by default', async () => {
    const controller = new AbortController();
    const reason = new Error('superseded');
    controller.abort(reason);
    await expect(withDeadline(new Promise(() => {}), 1_000, timedOut, controller.signal)).rejects.toBe(reason);
  });
});
