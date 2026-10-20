/**
 * Pure Tron encoding helpers for the MPC deposit + withdrawal flows. Ported from the verified
 * mainnet paths and kept byte-identical to the NEAR contract / ingest encoders — any divergence
 * breaks signature recovery (withdrawal) or memo matching (deposit).
 */
import { concat, keccak256, numberToHex, sha256, type Hex } from 'viem';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * base58check Tron address → 41-prefixed hex (drops the 4-byte checksum). Also accepts the 41-prefixed
 * hex form, with or without `0x`.
 *
 * Strict on purpose: these bytes become MPC-relay recipients and withdraw identities, so a typo that
 * still decodes must throw rather than resolve to someone else's account.
 */
export function tronBase58ToHex(addr: string): string {
  const hex = addr.startsWith('0x') ? addr.slice(2) : addr;
  if (/^41[0-9a-fA-F]{40}$/.test(hex)) return hex;
  if (addr.startsWith('0x')) throw new Error(`invalid Tron hex address (expected 0x41 + 20 bytes): ${addr}`);

  let n = 0n;
  for (const c of addr) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error(`invalid base58 char in Tron address: ${addr}`);
    n = n * 58n + BigInt(i);
  }
  // A Tron address is 25 bytes (0x41 ‖ 20-byte hash ‖ 4-byte checksum); the leading 0x41 means no
  // leading zero bytes, so the big-integer form is exactly 50 hex chars.
  const h = n.toString(16).padStart(50, '0');
  if (h.length !== 50 || !h.startsWith('41')) {
    throw new Error(`invalid Tron address (expected 25 bytes with 0x41 version): ${addr}`);
  }
  const payload = h.slice(0, 42);
  const checksum = sha256(sha256(`0x${payload}`)).slice(2, 10);
  if (h.slice(42) !== checksum) throw new Error(`invalid Tron address checksum: ${addr}`);
  return payload;
}

/**
 * Splice a 32-byte memo into a Tron `raw_data_hex` as protobuf field 10 (tag 0x52, length 0x20),
 * inserted before the first field with number ≥ 10. Matches the on-chain memo layout the relay reads.
 */
export function spliceMemo(rawHex: string, memoHex: string): string {
  const clean = memoHex.replace(/^0x/, '');
  if (clean.length !== 64) throw new Error(`memo must be 32 bytes (64 hex chars), got ${clean.length}`);
  const buf = Buffer.from(rawHex, 'hex');
  const readVarint = (p: number): [number, number] => {
    let v = 0;
    let s = 0;
    let i = p;
    for (;;) {
      const b = buf[i++];
      if (b === undefined) throw new Error('malformed varint in raw_data');
      v |= (b & 0x7f) << s;
      if (!(b & 0x80)) break;
      s += 7;
    }
    return [v, i];
  };
  let pos = 0;
  let at = buf.length;
  while (pos < buf.length) {
    const start = pos;
    const [tag, aft] = readVarint(pos);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field >= 10) {
      at = start;
      break;
    }
    if (wire === 0) [, pos] = readVarint(aft);
    else if (wire === 2) {
      const [len, al] = readVarint(aft);
      pos = al + len;
    } else throw new Error(`unexpected protobuf wire type ${wire} while splicing memo`);
  }
  return `${buf.subarray(0, at).toString('hex')}5220${clean}${buf.subarray(at).toString('hex')}`;
}

/**
 * Assemble the `broadcasthex` envelope: field 1 (raw_data) + field 2 (signature). The `41` before
 * the signature is its protobuf length — 65 bytes of `r‖s‖v` — not a Tron address version byte.
 */
export function assembleBroadcastHex(rawHex: string, signatureHex: string): string {
  const varint = (n: number): string => {
    const o: number[] = [];
    let x = n;
    while (x > 0x7f) {
      o.push((x & 0x7f) | 0x80);
      x >>>= 7;
    }
    o.push(x);
    return Buffer.from(o).toString('hex');
  };
  const sig = signatureHex.replace(/^0x/, '');
  return `0a${varint(rawHex.length / 2)}${rawHex}12${'41'}${sig}`;
}

/** Encode a Tron base58 address as a right-aligned 32-byte word (20-byte body, 0x41 prefix dropped). */
export function tronAddressToWord(addr: string): string {
  const body = tronBase58ToHex(addr).replace(/^41/, '');
  return body.padStart(64, '0');
}

/**
 * ABI-encoded arguments for a TRC-20 `transfer(address,uint256)`, as TronGrid's
 * `triggersmartcontract` wants them: the two 32-byte words WITHOUT the function selector (the node
 * derives that from `function_selector`) and without a `0x` prefix.
 */
export function encodeTrc20TransferParams(to: string, amount: bigint): string {
  return `${tronAddressToWord(to)}${numberToHex(amount, { size: 32 }).slice(2)}`;
}

/**
 * Withdrawal-auth identity for a Tron account (scheme 1): the 20-byte address hash — the base58
 * address's 21-byte payload (`0x41 ‖ hash`) with the `0x41` version byte dropped. Used as the
 * `sender` in the signed withdraw message and as the hub-wallet salt input (i.e. the value the hub's
 * `WalletFactory.getDeployedAddress` expects for a Tron source).
 */
export function tronIdentityBytes(base58Addr: string): Hex {
  return `0x${tronBase58ToHex(base58Addr).slice(2)}`;
}

/**
 * Inverse of {@link tronIdentityBytes} / {@link tronBase58ToHex}: encode a 20-byte address hash
 * (or a `0x41`-prefixed 21-byte hex) back to a base58check Tron address (`T…`).
 */
export function tronHashToBase58(hashHex: string): string {
  let h = hashHex.replace(/^0x/, '').toLowerCase();
  if (h.length === 40) h = `41${h}`; // bare 20-byte hash → add the version byte
  if (!/^41[0-9a-f]{40}$/.test(h)) throw new Error(`invalid Tron address hex: ${hashHex}`);
  const payload = Uint8Array.from(Buffer.from(h, 'hex'));
  const checksum = Uint8Array.from(Buffer.from(sha256(sha256(`0x${h}`)).slice(2), 'hex')).slice(0, 4);
  const full = Uint8Array.from([...payload, ...checksum]);
  let n = BigInt(`0x${Buffer.from(full).toString('hex')}`);
  let s = '';
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of full) {
    if (b === 0) s = `1${s}`;
    else break;
  }
  return s;
}

/**
 * Tron withdrawal recipient encoding: 12 zero-bytes ‖ 20-byte address hash (a left-padded 32-byte
 * word), matching the `AssetManager.transfer` recipient bytes the release expects.
 */
export function tronRecipientBytes(base58Addr: string): Hex {
  return `0x${tronAddressToWord(base58Addr)}`;
}

/** The signed withdraw-auth message (mirrors the NEAR contract's `SignedMessage`). */
export interface SignedWalletMessage {
  to: Hex; // hub wallet that executes `data`
  data: Hex; // encoded hub-wallet calls (e.g. AssetManager.transfer to burn + release)
  nonce: bigint; // any unused u64; replays are rejected on NEAR
  chainId: bigint; // the SOURCE chain id (Tron = 728126428n), not the hub's
  sender: Hex; // withdrawal-auth identity (tronIdentityBytes)
}

/**
 * keccak256(to ‖ data ‖ nonce_be8 ‖ chainId_be8 ‖ sender) — byte-identical to the contract's
 * `compute_message_hash`. The client signs the scheme-1 personal-sign digest of THIS hash: Tron
 * `signMessageV2` UTF-8 encodes its string argument (ethers `hashMessage` semantics), so what gets
 * signed is the 66-character `"0x"`-prefixed lowercase hex STRING of the hash under the
 * `"\x19TRON Signed Message:\n66"` prefix — not the 32 raw bytes.
 */
export function computeSignedMessageHash(m: SignedWalletMessage): Hex {
  return keccak256(
    concat([m.to, m.data, numberToHex(m.nonce, { size: 8 }), numberToHex(m.chainId, { size: 8 }), m.sender]),
  );
}
