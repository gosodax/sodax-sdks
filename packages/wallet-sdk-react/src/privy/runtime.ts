import { LOGIN_OPEN_MS } from './constants.js';
import type { Eip1193Like } from './deferredProvider.js';
import { abortReason, PrivyTimeoutError, PrivyUnavailableError, userRejected, withTimeout } from './errors.js';

/** The embedded wallet as the connector needs it; `PrivyBridge` adapts Privy's `ConnectedWallet`. */
export type EmbeddedWallet = {
  readonly address: string;
  readonly getEthereumProvider: () => Promise<Eip1193Like>;
  readonly switchChain: (chainId: number) => Promise<void>;
};

export type PrivySnapshot = {
  readonly ready: boolean;
  readonly authenticated: boolean;
  /** Privy's initialisation error, or why `PrivyProvider` could not start; waiters reject with it. */
  readonly error: Error | null;
  readonly userLoaded: boolean;
  /** The user's linked accounts already hold a Privy Ethereum wallet (ahead of `useWallets()`). */
  readonly hasEmbeddedAccount: boolean;
  /** The user's first embedded Ethereum wallet (`walletIndex` 0). */
  readonly embedded: EmbeddedWallet | undefined;
  /** Privy's modal is on screen (`usePrivy().isModalOpen`). */
  readonly modalOpen: boolean;
};

type PrivyOps = {
  readonly login: () => void;
  readonly logout: () => Promise<void>;
  readonly createWallet: () => Promise<unknown>;
};

export type PrivyRuntime = {
  getSnapshot(): PrivySnapshot;
  subscribe(listener: () => void): () => void;
  /** Resolves once `predicate` holds; rejects on Privy's error, the deadline, abort or bridge unmount. */
  waitFor(
    predicate: (snapshot: PrivySnapshot) => boolean,
    timeoutMs: number,
    signal?: AbortSignal,
    what?: string,
  ): Promise<PrivySnapshot>;
  /**
   * Opens Privy's login modal. Once it is on screen the wait is untimed; it settles when the user is
   * authenticated (by any path) and Privy's modal has closed, when the modal closes without a sign-in, or
   * on abort — and fails if no modal appears in time.
   */
  login(signal?: AbortSignal): Promise<void>;
  logout(): Promise<void>;
  createWallet(): Promise<void>;
  // Bridge side.
  publish(next: PrivySnapshot): void;
  attach(ops: PrivyOps): void;
  loginCompleted(): void;
  loginFailed(code: string): void;
  unmount(): void;
  /** `PrivyProvider` failed to start: every current and future wait rejects with `error`. */
  fail(error: Error): void;
};

const UNMOUNTED: PrivySnapshot = {
  ready: false,
  authenticated: false,
  error: null,
  userLoaded: false,
  hasEmbeddedAccount: false,
  embedded: undefined,
  modalOpen: false,
};

type Pending = { reject(error: Error): void };

/** One per `SodaxWalletProvider` mount; creating it has no side effects. */
export function createPrivyRuntime(): PrivyRuntime {
  let snapshot = UNMOUNTED;
  let ops: PrivyOps | undefined;
  let pendingLogin: { resolve(): void; reject(error: Error): void } | undefined;
  const listeners = new Set<() => void>();
  const waiters = new Set<Pending>();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const requireOps = (): PrivyOps => {
    if (!ops) throw new PrivyUnavailableError();
    return ops;
  };

  const settleLogin = (error?: Error) => {
    const pending = pendingLogin;
    pendingLogin = undefined;
    if (!pending) return;
    if (error) pending.reject(error);
    else pending.resolve();
  };

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    waitFor(predicate, timeoutMs, signal, what = 'Waiting for Privy') {
      let cleanup = () => {};
      const settled = new Promise<PrivySnapshot>((resolve, reject) => {
        const waiter: Pending = { reject };
        const check = () => {
          if (predicate(snapshot)) resolve(snapshot);
          else if (snapshot.error) reject(snapshot.error);
        };
        waiters.add(waiter);
        listeners.add(check);
        cleanup = () => {
          waiters.delete(waiter);
          listeners.delete(check);
        };
        check();
      });
      return withTimeout(settled, timeoutMs, what, signal).finally(cleanup);
    },

    login(signal) {
      const current = ops;
      if (!current) return Promise.reject(new PrivyUnavailableError());
      settleLogin(userRejected('Superseded by a newer login attempt.'));
      return new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let shown = false;
        // Done only once the modal closes: after the code, Privy still creates a new user's wallet there, and a
        // wallet created alongside it would be a second one. Authenticated by any path counts, not only `onComplete`.
        const watch = () => {
          if (snapshot.modalOpen) {
            shown = true;
            clearTimeout(timer);
          } else if (snapshot.authenticated) settleLogin();
          else if (shown) settleLogin(userRejected('The Privy login closed without signing in.'));
        };
        const onAbort = () => settleLogin(abortReason(signal));
        const cleanup = () => {
          clearTimeout(timer);
          listeners.delete(watch);
          signal?.removeEventListener('abort', onAbort);
        };
        pendingLogin = {
          resolve() {
            cleanup();
            resolve();
          },
          reject(error) {
            cleanup();
            reject(error);
          },
        };
        if (signal?.aborted) return onAbort();
        signal?.addEventListener('abort', onAbort);
        listeners.add(watch);
        timer = setTimeout(() => {
          if (!snapshot.modalOpen) settleLogin(new PrivyTimeoutError('Opening the Privy login', LOGIN_OPEN_MS));
        }, LOGIN_OPEN_MS);
        current.login();
      });
    },

    async logout() {
      await requireOps().logout();
    },

    async createWallet() {
      await requireOps().createWallet();
    },

    publish(next) {
      snapshot = next;
      notify();
    },

    attach(next) {
      ops = next;
    },

    loginCompleted() {
      settleLogin();
    },

    loginFailed(code) {
      // Wrong codes, captcha and rate limits are recoverable inside the modal; only closing it ends the attempt.
      if (code === 'exited_auth_flow') settleLogin(userRejected('The user closed the Privy login.'));
    },

    unmount() {
      ops = undefined;
      snapshot = UNMOUNTED;
      notify();
      // StrictMode unmounts and remounts synchronously; only a bridge that stays gone ends pending waits.
      queueMicrotask(() => {
        if (ops) return;
        const unloaded = new PrivyUnavailableError();
        settleLogin(unloaded);
        for (const waiter of [...waiters]) waiter.reject(unloaded);
      });
    },

    fail(error) {
      ops = undefined;
      snapshot = { ...UNMOUNTED, error };
      settleLogin(error);
      notify();
    },
  };
}
