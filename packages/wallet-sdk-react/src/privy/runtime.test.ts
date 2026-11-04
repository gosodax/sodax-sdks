import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserRejectedRequestError } from 'viem';
import { LOGIN_OPEN_MS } from './constants.js';
import { PrivyTimeoutError, PrivyUnavailableError } from './errors.js';
import { createPrivyRuntime, type PrivySnapshot } from './runtime.js';

const ready: PrivySnapshot = {
  ready: true,
  authenticated: false,
  error: null,
  userLoaded: false,
  hasEmbeddedAccount: false,
  embedded: undefined,
  modalOpen: false,
};

const ops = () => ({
  login: vi.fn(),
  logout: vi.fn(async () => undefined),
  createWallet: vi.fn(async () => undefined),
});
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createPrivyRuntime', () => {
  it('keeps waits alive through a StrictMode unmount and immediate remount', async () => {
    const runtime = createPrivyRuntime();
    runtime.attach(ops());
    const waiting = runtime.waitFor(s => s.ready, 1_000);

    runtime.unmount();
    runtime.attach(ops());
    runtime.publish({ ...ready, ready: false });
    await settle();
    runtime.publish(ready);

    await expect(waiting).resolves.toMatchObject({ ready: true });
  });

  it('ends pending waits and logins once the bridge stays unmounted', async () => {
    const runtime = createPrivyRuntime();
    runtime.attach(ops());
    const waiting = expect(runtime.waitFor(s => s.ready, 1_000)).rejects.toBeInstanceOf(PrivyUnavailableError);
    const loggingIn = expect(runtime.login()).rejects.toBeInstanceOf(PrivyUnavailableError);

    runtime.unmount();
    await settle();

    await waiting;
    await loggingIn;
    expect(runtime.getSnapshot().ready).toBe(false);
  });

  it('rejects current and later waits with the start-up failure', async () => {
    const runtime = createPrivyRuntime();
    const failure = new Error('Cannot initialize the Privy provider with an invalid Privy app ID');
    const waiting = runtime.waitFor(s => s.ready, 1_000);

    runtime.fail(failure);

    await expect(waiting).rejects.toBe(failure);
    await expect(runtime.waitFor(s => s.ready, 1_000)).rejects.toBe(failure);
  });

  it('rejects a wait with the reason it was aborted for', async () => {
    const runtime = createPrivyRuntime();
    const controller = new AbortController();
    const waiting = runtime.waitFor(s => s.ready, 1_000, controller.signal);
    const reason = new PrivyTimeoutError('Restoring the Privy session', 3_000);

    controller.abort(reason);

    await expect(waiting).rejects.toBe(reason);
  });

  it('times a wait out when the predicate never holds', async () => {
    vi.useFakeTimers();
    const runtime = createPrivyRuntime();
    const waiting = runtime.waitFor(s => s.ready, 500);
    const assertion = expect(waiting).rejects.toBeInstanceOf(PrivyTimeoutError);

    await vi.advanceTimersByTimeAsync(500);

    await assertion;
    vi.useRealTimers();
  });

  describe('login', () => {
    afterEach(() => vi.useRealTimers());

    it('fails when Privy never puts its login on screen (it only warns while it still holds a user)', async () => {
      vi.useFakeTimers();
      const runtime = createPrivyRuntime();
      runtime.attach(ops());
      runtime.publish(ready);

      const loggingIn = runtime.login();
      const outcome = expect(loggingIn).rejects.toThrow('Opening the Privy login');
      await vi.advanceTimersByTimeAsync(LOGIN_OPEN_MS);

      await outcome;
    });

    it('waits as long as the user needs once the login is on screen', async () => {
      vi.useFakeTimers();
      const runtime = createPrivyRuntime();
      const privy = ops();
      privy.login.mockImplementation(() => runtime.publish({ ...ready, modalOpen: true }));
      runtime.attach(privy);
      runtime.publish(ready);
      let settled = false;

      const loggingIn = runtime.login().finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(LOGIN_OPEN_MS * 20);
      expect(settled).toBe(false);
      runtime.loginCompleted();

      await expect(loggingIn).resolves.toBeUndefined();
    });

    it("waits out Privy's own steps after the code (it creates a new user's wallet) until its modal closes", async () => {
      const runtime = createPrivyRuntime();
      const privy = ops();
      privy.login.mockImplementation(() => runtime.publish({ ...ready, modalOpen: true }));
      runtime.attach(privy);
      runtime.publish(ready);
      let settled = false;

      const loggingIn = runtime.login().finally(() => {
        settled = true;
      });
      runtime.publish({ ...ready, authenticated: true, userLoaded: true, modalOpen: true });
      await settle();
      expect(settled).toBe(false);
      runtime.publish({ ...ready, authenticated: true, userLoaded: true, hasEmbeddedAccount: true });

      await expect(loggingIn).resolves.toBeUndefined();
    });

    it('rejects as a user rejection when the modal closes without a sign-in (e.g. terms declined)', async () => {
      const runtime = createPrivyRuntime();
      const privy = ops();
      privy.login.mockImplementation(() => runtime.publish({ ...ready, modalOpen: true }));
      runtime.attach(privy);
      runtime.publish(ready);

      const loggingIn = runtime.login();
      runtime.publish(ready);

      await expect(loggingIn).rejects.toBeInstanceOf(UserRejectedRequestError);
    });

    it('ends the wait once Privy reports the user authenticated, with or without onComplete', async () => {
      const runtime = createPrivyRuntime();
      runtime.attach(ops());
      runtime.publish(ready);

      const loggingIn = runtime.login();
      runtime.publish({ ...ready, authenticated: true, userLoaded: true });

      await expect(loggingIn).resolves.toBeUndefined();
    });
  });
});
