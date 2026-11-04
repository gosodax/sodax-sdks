/**
 * Lace's injected CIP-30 wallet (`window.cardano.lace`), read structurally so this package takes no Cardano wallet
 * dependency. Every transaction, address and signature crosses CIP-30 as hex CBOR / hex bytes; responses are
 * validated here rather than trusted.
 */

export interface Cip30DataSignature {
  signature: string;
  key: string;
}

export interface Cip30Api {
  getNetworkId: () => Promise<number>;
  getUsedAddresses: () => Promise<string[]>;
  getChangeAddress: () => Promise<string>;
  getBalance: () => Promise<string>;
  signTx: (tx: string, partialSign?: boolean) => Promise<string>;
  signData: (address: string, payload: string) => Promise<Cip30DataSignature>;
  submitTx: (tx: string) => Promise<string>;
}

export interface Cip30Wallet {
  enable: () => Promise<unknown>;
  isEnabled?: () => Promise<boolean>;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const API_METHODS = [
  'getNetworkId',
  'getUsedAddresses',
  'getChangeAddress',
  'getBalance',
  'signTx',
  'signData',
  'submitTx',
] as const;

/** The injected Lace wallet, or `undefined` when the extension is not installed or not yet injected. */
export function getLaceWallet(): Cip30Wallet | undefined {
  if (typeof window === 'undefined' || !('cardano' in window)) return undefined;
  const cardano = window.cardano;
  if (!isObject(cardano) || !('lace' in cardano)) return undefined;
  const lace = cardano.lace;
  return isObject(lace) && typeof lace.enable === 'function' ? (lace as unknown as Cip30Wallet) : undefined;
}

/** The API `enable()` resolved to, or `undefined` when it lacks a CIP-30 method this package calls. */
export function readCip30Api(value: unknown): Cip30Api | undefined {
  return isObject(value) && API_METHODS.every(method => typeof value[method] === 'function')
    ? (value as unknown as Cip30Api)
    : undefined;
}

/** A `signData` result: the COSE_Sign1 and COSE_Key, both hex strings. */
export function readDataSignature(value: unknown): Cip30DataSignature | undefined {
  return isObject(value) && typeof value.signature === 'string' && typeof value.key === 'string'
    ? { signature: value.signature, key: value.key }
    : undefined;
}

/**
 * Lovelace in a CIP-30 `getBalance` value: a CBOR uint, or `[uint, multiasset]` when the wallet holds native
 * tokens. Returns `undefined` for anything else rather than guess.
 */
export function readLovelace(cborHex: string): bigint | undefined {
  if (!/^([0-9a-fA-F]{2})+$/.test(cborHex)) return undefined;
  const bytes = Uint8Array.from(cborHex.match(/../g) ?? [], byte => Number.parseInt(byte, 16));
  let at = 0;
  if (bytes[at] === 0x82) at += 1;
  const head = bytes[at];
  if (head === undefined || head >> 5 !== 0) return undefined;
  const info = head & 0x1f;
  at += 1;
  if (info < 24) return BigInt(info);
  const width = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
  if (width === 0 || at + width > bytes.length) return undefined;
  let value = 0n;
  for (const byte of bytes.slice(at, at + width)) value = (value << 8n) | BigInt(byte);
  return value;
}
