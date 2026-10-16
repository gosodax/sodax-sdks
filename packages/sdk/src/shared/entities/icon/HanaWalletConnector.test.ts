import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IconAddress } from '@sodax/types';
import { requestAddress, requestSigning, requestJsonRpc } from './HanaWalletConnector.js';

// WALLET-L-1: the ICONEX relay shares one window-event channel with no per-request
// correlation id. The fix serializes requests (at most one in flight) and adds a timeout with
// guaranteed listener cleanup. These tests guard those properties on the public @sodax/sdk helpers.
describe('HanaWalletConnector — ICONEX relay helpers (WALLET-L-1)', () => {
  const FROM = 'hx1234567890abcdef1234567890abcdef12345678' as IconAddress;

  let win: any;

  // Flush pending microtasks (drains the serialization queue) via a real macrotask.
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));

  function onRequest(reply: (detail: any) => void) {
    win.addEventListener('ICONEX_RELAY_REQUEST', (event: Event) => {
      reply((event as CustomEvent).detail);
    });
  }

  function respond(detail: any) {
    win.dispatchEvent(new CustomEvent('ICONEX_RELAY_RESPONSE', { detail }));
  }

  beforeEach(() => {
    win = new EventTarget();
    globalThis.window = win;
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = undefined;
    vi.useRealTimers();
  });

  it('resolves requestAddress with an ok Result', async () => {
    onRequest(() => respond({ type: 'RESPONSE_ADDRESS', payload: FROM }));

    await expect(requestAddress()).resolves.toEqual({ ok: true, value: FROM });
  });

  it('resolves requestJsonRpc with a well-formed RESPONSE_JSON-RPC payload', async () => {
    onRequest(req => respond({ type: 'RESPONSE_JSON-RPC', payload: { id: req.payload.id, result: '0xhash' } }));

    await expect(requestJsonRpc({ tx: 1 }, 12345)).resolves.toEqual({
      ok: true,
      value: { id: 12345, result: '0xhash' },
    });
  });

  it('rejects requestJsonRpc immediately on a malformed RESPONSE_JSON-RPC (no string result)', async () => {
    // A JSON-RPC error response ({ id, error }) carries no string `result`; it must fail fast,
    // not hang until the timeout.
    onRequest(req =>
      respond({ type: 'RESPONSE_JSON-RPC', payload: { id: req.payload.id, error: { code: -1, message: 'nope' } } }),
    );

    await expect(requestJsonRpc({ tx: 1 }, 1)).rejects.toThrow('Invalid payload response type');
  });

  it('rejects requestJsonRpc on CANCEL_JSON-RPC', async () => {
    onRequest(() => respond({ type: 'CANCEL_JSON-RPC', payload: null }));

    await expect(requestJsonRpc({ tx: 1 }, 1)).rejects.toThrow('CANCEL_JSON-RPC');
  });

  it('rejects requestSigning on CANCEL_SIGNING', async () => {
    onRequest(() => respond({ type: 'CANCEL_SIGNING', payload: null }));

    await expect(requestSigning(FROM, 'HASH')).rejects.toThrow('CANCEL_SIGNING');
  });

  it('serializes: at most one request is in flight, so a response cannot cross-resolve', async () => {
    // The wallet stub records requests but never answers on its own — the test drives
    // responses. This fails against non-serialized code (both requests would dispatch, and the
    // first response would resolve BOTH promises).
    const dispatched: string[] = [];
    win.addEventListener('ICONEX_RELAY_REQUEST', (event: Event) => {
      const d = (event as CustomEvent).detail;
      if (d.type === 'REQUEST_SIGNING') dispatched.push(d.payload.hash);
    });

    const p1 = requestSigning(FROM, 'HASH_A');
    const p2 = requestSigning(FROM, 'HASH_B');

    await tick();
    // Only the first request is in flight; the second is queued behind it.
    expect(dispatched).toEqual(['HASH_A']);

    respond({ type: 'RESPONSE_SIGNING', payload: 'sig:HASH_A' });
    await expect(p1).resolves.toEqual({ ok: true, value: 'sig:HASH_A' });

    await tick();
    // The queue advanced; the second request now dispatches.
    expect(dispatched).toEqual(['HASH_A', 'HASH_B']);

    respond({ type: 'RESPONSE_SIGNING', payload: 'sig:HASH_B' });
    await expect(p2).resolves.toEqual({ ok: true, value: 'sig:HASH_B' });
  });

  it('rejects when there is no browser window, without wedging the shared queue', async () => {
    (globalThis as { window?: unknown }).window = undefined;
    await expect(requestAddress()).rejects.toThrow('require a browser environment');

    // Restore the window; a subsequent request must still resolve (the queue is not wedged).
    win = new EventTarget();
    globalThis.window = win;
    onRequest(() => respond({ type: 'RESPONSE_ADDRESS', payload: FROM }));

    await expect(requestAddress()).resolves.toEqual({ ok: true, value: FROM });
  });

  it('times out and removes the exact response listener it added', async () => {
    vi.useFakeTimers();
    const addSpy = vi.spyOn(win, 'addEventListener');
    const removeSpy = vi.spyOn(win, 'removeEventListener');

    const pending = requestAddress();
    await vi.advanceTimersByTimeAsync(300_000);

    await expect(pending).rejects.toThrow('timed out');
    const addedHandler = addSpy.mock.calls.find((c: unknown[]) => c[0] === 'ICONEX_RELAY_RESPONSE')?.[1];
    expect(addedHandler).toBeDefined();
    expect(removeSpy).toHaveBeenCalledWith('ICONEX_RELAY_RESPONSE', addedHandler, false);
  });
});
