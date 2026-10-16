/**
 * ICONEX relay channel hardening (WALLET-L-1).
 *
 * request() must correlate responses by expected type (not resolve on the first
 * ICONEX_RELAY_RESPONSE of any type), time out instead of hanging forever, and
 * remove its listener on settle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ICONEX_REQUEST_TIMEOUT_MS, ICONexRequestEventType, ICONexResponseEventType, request } from './index.js';

const ICONEX_RELAY_RESPONSE = 'ICONEX_RELAY_RESPONSE';
const VALID_ICON_ADDRESS = 'hx0000000000000000000000000000000000000001';

const dispatchResponse = (type: ICONexResponseEventType, payload?: string): void => {
  window.dispatchEvent(new CustomEvent(ICONEX_RELAY_RESPONSE, { detail: { type, payload } }));
};

// Let the serialized queue run its callback (register the listener + dispatch the request).
const flushQueue = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('ICONEX request() channel', () => {
  afterEach(() => vi.useRealTimers());

  it('ignores an uncorrelated response and resolves only on the expected type', async () => {
    const pending = request({ type: ICONexRequestEventType.REQUEST_ADDRESS });
    await flushQueue();

    // A forged/uncorrelated event (wrong type) must NOT resolve the address request.
    dispatchResponse(ICONexResponseEventType.RESPONSE_SIGNING, 'attacker-controlled');
    // The correctly-typed response resolves it.
    dispatchResponse(ICONexResponseEventType.RESPONSE_ADDRESS, VALID_ICON_ADDRESS);

    const detail = await pending;
    expect(detail.type).toBe(ICONexResponseEventType.RESPONSE_ADDRESS);
    expect(detail.payload).toBe(VALID_ICON_ADDRESS);
  });

  it('times out and rejects when no response arrives, and ignores a late response', async () => {
    vi.useFakeTimers();
    const pending = request({ type: ICONexRequestEventType.REQUEST_ADDRESS });
    const rejection = expect(pending).rejects.toThrow(/timed out/);

    await vi.advanceTimersByTimeAsync(ICONEX_REQUEST_TIMEOUT_MS);
    await rejection;

    // Listener was removed on timeout — a late response is a no-op (no unhandled resolution).
    expect(() => dispatchResponse(ICONexResponseEventType.RESPONSE_ADDRESS, VALID_ICON_ADDRESS)).not.toThrow();
  });

  // An unanswered short-timeout request (hydration) must not hold the FIFO queue for 300s.
  it('a short-timeout request frees the queue for the next request when it times out', async () => {
    vi.useFakeTimers();
    const hydration = request({ type: ICONexRequestEventType.REQUEST_ADDRESS }, 30_000);
    const hydrationRejection = expect(hydration).rejects.toThrow(/timed out/);
    const userConnect = request({ type: ICONexRequestEventType.REQUEST_ADDRESS });

    await vi.advanceTimersByTimeAsync(30_000);
    await hydrationRejection;

    // The queued user request dispatches now — far before the interactive timeout.
    await vi.advanceTimersByTimeAsync(0);
    dispatchResponse(ICONexResponseEventType.RESPONSE_ADDRESS, VALID_ICON_ADDRESS);
    await expect(userConnect).resolves.toMatchObject({ payload: VALID_ICON_ADDRESS });
  });

  // A dismissed interactive prompt sends no relay event, so the bounded timeout is what frees the queue.
  it('an unanswered interactive request frees the queue at the bounded timeout', async () => {
    vi.useFakeTimers();
    const dismissed = request({ type: ICONexRequestEventType.REQUEST_ADDRESS });
    const rejection = expect(dismissed).rejects.toThrow(/timed out/);
    const retry = request({ type: ICONexRequestEventType.REQUEST_ADDRESS });

    await vi.advanceTimersByTimeAsync(ICONEX_REQUEST_TIMEOUT_MS);
    await rejection;

    await vi.advanceTimersByTimeAsync(0);
    dispatchResponse(ICONexResponseEventType.RESPONSE_ADDRESS, VALID_ICON_ADDRESS);
    await expect(retry).resolves.toMatchObject({ payload: VALID_ICON_ADDRESS });
  });
});
