import type { IBitcoinWalletProvider } from '@sodax/types';

/**
 * `IBitcoinWalletProvider` declares both signing methods as required, so these checks are
 * about runtime reality rather than types: a provider built by a custom connector may not
 * honour the whole contract. Guarding turns that into a named error instead of a
 * `... is not a function` TypeError.
 */

/** Wallet providers that implement BIP-322 message signing (Unisat, Xverse, OKX, Hana). */
export function hasSignBip322(p: IBitcoinWalletProvider): boolean {
  return typeof p.signBip322Message === 'function';
}

/** Wallet providers that implement legacy ECDSA message signing. */
export function hasSignEcdsa(p: IBitcoinWalletProvider): boolean {
  return typeof p.signEcdsaMessage === 'function';
}
