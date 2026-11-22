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
  getUtxos: () => Promise<string[] | null>;
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
  'getUtxos',
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

/** Lace's first used address, or its change address before it has received funds. */
export async function getLaceAddressHex(api: Cip30Api): Promise<string> {
  const [used] = await api.getUsedAddresses();
  return (used ?? (await api.getChangeAddress())).replace(/^0x/i, '').toLowerCase();
}
