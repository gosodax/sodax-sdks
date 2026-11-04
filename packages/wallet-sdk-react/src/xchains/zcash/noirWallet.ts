/**
 * Noir Wallet's injected Zcash provider (`window.noirwallet.zcash`), read structurally so this package takes no
 * `@noir-wallet/sdk` dependency. Every call is `request({ method, params })`; responses are validated here
 * rather than trusted.
 */

export interface NoirZcashProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null;

function isNoirZcashProvider(value: unknown): value is NoirZcashProvider {
  return isObject(value) && 'request' in value && typeof value.request === 'function';
}

/** The injected provider, or `undefined` when Noir Wallet is not installed or not yet injected. */
export function getNoirZcashProvider(): NoirZcashProvider | undefined {
  if (typeof window === 'undefined' || !('noirwallet' in window)) return undefined;
  const noir = window.noirwallet;
  if (!isObject(noir) || !('isNoirWallet' in noir) || noir.isNoirWallet !== true) return undefined;
  return 'zcash' in noir && isNoirZcashProvider(noir.zcash) ? noir.zcash : undefined;
}

/** The transparent address in a `zcash_requestAccounts` / `zcash_getAccounts` / `zcash_getAddresses` result. */
export function readTransparentAddress(result: unknown): string | undefined {
  if (!isObject(result) || !('transparent' in result)) return undefined;
  return typeof result.transparent === 'string' && result.transparent.startsWith('t1') ? result.transparent : undefined;
}

/** The signature and signing address in a `zcash_signMessage` result. */
export function readSignedMessage(result: unknown): { signature: string; address: string } | undefined {
  if (!isObject(result) || !('signature' in result) || !('address' in result)) return undefined;
  const { signature, address } = result;
  return typeof signature === 'string' && typeof address === 'string' ? { signature, address } : undefined;
}

/** The transparent balance, as a ZEC decimal string, in a `zcash_getBalance` result. */
export function readTransparentBalance(result: unknown): string | undefined {
  if (!isObject(result) || !('transparent' in result)) return undefined;
  return typeof result.transparent === 'string' ? result.transparent : undefined;
}
