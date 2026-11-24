/**
 * The withdraw-auth message shared by every MPC-relay chain.
 *
 * The message hash is chain-agnostic — only the DIGEST that gets signed differs per scheme
 * (Tron wraps it TIP-191, XRP signs the raw hash, Aptos uses Petra's envelope). Keeping the hash
 * in one place is deliberate: an earlier duplicate of the Tron digest drifted from the contract
 * and produced signatures that recovered a valid-but-wrong address, which the relay rejects with
 * "Recovered address does not match sender". Per-scheme wrapping belongs in the wallet provider;
 * this stays common.
 */
import { concat, keccak256, numberToHex, type Hex } from 'viem';

/** Mirrors the NEAR contract's `SignedMessage` (minus `scheme`/`public_key`, which ride alongside). */
export interface SignedWalletMessage {
  /** Hub wallet that executes `data`. */
  to: Hex;
  /** Encoded hub-wallet calls (e.g. `AssetManager.transfer` to burn + release). */
  data: Hex;
  /** Any unused u64; replays are rejected on NEAR via the `msg:` nonce set. */
  nonce: bigint;
  /** The SOURCE chain's relay id (Tron `728126428n`, XRP `66n`) — never the hub's. */
  chainId: bigint;
  /** Withdrawal-auth identity: the 20-byte spoke identity for this chain. */
  sender: Hex;
}

/**
 * `keccak256(to ‖ data ‖ nonce_be8 ‖ chainId_be8 ‖ sender)` — byte-identical to the NEAR
 * contract's `compute_message_hash`. Any divergence here breaks signature recovery for every
 * chain at once, so it is exercised against fixtures taken from live mainnet withdrawals.
 */
export function computeSignedMessageHash(m: SignedWalletMessage): Hex {
  return keccak256(
    concat([m.to, m.data, numberToHex(m.nonce, { size: 8 }), numberToHex(m.chainId, { size: 8 }), m.sender]),
  );
}
