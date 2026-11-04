import type { CardanoDataSignature } from '@sodax/types';

/** Defaults for the Cardano provider. */
export type CardanoWalletDefaults = Record<string, never>;

/**
 * The CIP-30 calls the provider needs, kept STRUCTURAL so this package takes no wallet dependency; a connector
 * adapts the injected wallet (Lace, Eternl, …) to it. Every transaction and signature is hex CBOR without a `0x`,
 * as CIP-30 passes them.
 */
export interface CardanoWalletLike {
  /** The account's bech32 key-hash payment address: the deposit owner and the scheme-7 identity. */
  getAddress: () => Promise<string>;
  /** `api.signTx(tx, false)`: the witness set (hex CBOR) for a full transaction the sdk built. */
  signTx: (unsignedTx: string) => Promise<string>;
  /** `api.submitTx(tx)`: broadcasts a signed transaction and resolves to its tx hash. */
  submitTx: (signedTx: string) => Promise<string>;
  /** `api.signData(address, payload)` with the account's address; `payload` is hex without a `0x`. */
  signData: (payload: string) => Promise<CardanoDataSignature>;
}

export type CardanoWalletConfig = {
  wallet: CardanoWalletLike;
  defaults?: CardanoWalletDefaults;
};
