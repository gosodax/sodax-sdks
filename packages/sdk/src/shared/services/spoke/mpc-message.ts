// The message hash is chain-agnostic; only the signed digest differs per scheme, and that wrapping belongs in the
// wallet provider. A duplicated hash once drifted and recovered a wrong address, so keep it in one place.
import { bytesToBigInt, concat, keccak256, numberToHex, type Hex } from 'viem';

/** Mirrors the NEAR contract's `SignedMessage` (minus `scheme`/`public_key`, which ride alongside). */
export interface SignedWalletMessage {
  /** Hub wallet that executes `data`. */
  to: Hex;
  /** Encoded hub-wallet calls (e.g. `AssetManager.transfer` to burn + release). */
  data: Hex;
  /** Any unused value within {@link MAX_SAFE_NONCE}; replays are rejected on NEAR via the `msg:` nonce set. */
  nonce: bigint;
  /** The SOURCE chain's relay id (Tron `728126428n`, XRP `66n`) — never the hub's. */
  chainId: bigint;
  /** The 20-byte spoke identity for this chain. */
  sender: Hex;
}

/** `keccak256(to ‖ data ‖ nonce_be8 ‖ chainId_be8 ‖ sender)`, byte-identical to the NEAR `compute_message_hash`. */
export function computeSignedMessageHash(m: SignedWalletMessage): Hex {
  return keccak256(
    concat([m.to, m.data, numberToHex(m.nonce, { size: 8 }), numberToHex(m.chainId, { size: 8 }), m.sender]),
  );
}

/**
 * The relay passes the nonce through a JS `number`, so a larger one arrives rounded and the withdrawal is rejected
 * ("Recovered address does not match sender") after the nonce is spent.
 */
export const MAX_SAFE_NONCE = (1n << 53n) - 1n;

/** Random rather than a timestamp: NEAR rejects repeats but needs no ordering, avoiding same-ms and clock-skew collisions. */
export function randomWithdrawNonce(): bigint {
  return bytesToBigInt(crypto.getRandomValues(new Uint8Array(8))) & MAX_SAFE_NONCE;
}
