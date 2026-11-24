import { bech32 } from '@scure/base';
import { hexToBytes } from 'viem';

const MAINNET_NETWORK_ID = 1;
/** Longest address string a base address needs; bech32's default limit of 90 is too short for one. */
const MAX_ADDRESS_CHARS = 200;
/** Header types with a KEY-hash payment credential: base (key, key) and (key, script), and enterprise (key). */
const KEY_PAYMENT_LENGTHS: Readonly<Record<number, number>> = { 0: 57, 2: 57, 6: 29 };

/**
 * The mainnet `addr1…` form of the raw address bytes a CIP-30 wallet returns (hex, no `0x`). Only an address whose
 * payment credential is a key hash is accepted: that key signs the account's data and its hash is the identity the
 * relay knows it by. A script, pointer, reward or Byron address, or one on another network, is refused.
 */
export function cardanoAddressFromRawHex(rawHex: string): string {
  const raw = hexToBytes(`0x${rawHex.replace(/^0x/i, '')}`);
  const header = raw[0];
  if (header === undefined) throw new Error('Cardano wallet returned an empty address');
  const type = header >> 4;
  const expectedLength = KEY_PAYMENT_LENGTHS[type];
  if (expectedLength === undefined) {
    throw new Error(
      `Cardano address header type ${type} cannot sign data: use an address with a key-hash payment credential (enterprise or base)`,
    );
  }
  if (raw.length !== expectedLength)
    throw new Error(`Cardano address of type ${type} must be ${expectedLength} bytes, got ${raw.length}`);
  const networkId = header & 0x0f;
  if (networkId !== MAINNET_NETWORK_ID) {
    throw new Error(
      `Cardano address is on network id ${networkId}, but SODAX runs on mainnet (id ${MAINNET_NETWORK_ID})`,
    );
  }
  return bech32.encode('addr', bech32.toWords(raw), MAX_ADDRESS_CHARS);
}
