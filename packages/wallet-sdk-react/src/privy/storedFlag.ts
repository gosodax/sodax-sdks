/**
 * A flag in localStorage that survives browser restarts (Privy connected, a sign-out still owed). It cannot
 * live in wagmi's storage: the SDK backs that with `cookieStorage`, whose cookies carry no expiry and die
 * when the browser quits. Every operation is total — storage can be missing (SSR) or throw (Safari private mode).
 */
export function createStoredFlag(key: string) {
  return {
    read: () => withStorage(storage => storage.getItem(key) === '1', false),
    write: () => withStorage(storage => storage.setItem(key, '1'), undefined),
    clear: () => withStorage(storage => storage.removeItem(key), undefined),
  };
}

// Unusable storage only costs the reload restore; the live connection is unaffected.
function withStorage<T>(run: (storage: Storage) => T, fallback: T): T {
  try {
    return typeof window === 'undefined' ? fallback : run(window.localStorage);
  } catch {
    return fallback;
  }
}
