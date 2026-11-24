/**
 * Pure XRPL encoding helpers for the MPC deposit + withdrawal flows.
 *
 * Ported from the verified mainnet path (`MPC-relay/v2/scripts/xrp-withdraw.mjs`) and kept
 * byte-identical to the NEAR contract's decoders — any divergence breaks signature recovery
 * (withdrawal) or memo matching (deposit).
 *
 * XRPL identity is NOT the public key: a classic `r...` address encodes the 20-byte AccountID,
 * which is `ripemd160(sha256(pubkey))` over the FULL 33-byte `0xED`-prefixed ed25519 key. So the
 * withdraw-auth `sender` and the submitted `publicKey` are different values and are not
 * interchangeable — the contract derives the former from the latter and compares.
 */
import { sha256, type Hex } from 'viem';

/** XRPL's base58 alphabet — deliberately NOT the Bitcoin/Tron ordering. */
const XRPL_ALPHABET = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

const sha256d = (b: Uint8Array): Uint8Array => sha256(sha256(b, 'bytes'), 'bytes');

/** Classic `r...` address → 20-byte AccountID, with length, checksum and account type prefix verified. */
export function decodeAccountId(addr: string): Uint8Array {
  let n = 0n;
  for (const ch of addr) {
    const i = XRPL_ALPHABET.indexOf(ch);
    if (i < 0) throw new Error(`invalid XRPL address character: ${ch}`);
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let lead = 0;
  for (const ch of addr) {
    if (ch === XRPL_ALPHABET[0]) lead++;
    else break;
  }
  const buf = Uint8Array.from(Buffer.from('00'.repeat(lead) + hex, 'hex'));
  if (buf.length !== 25) throw new Error(`bad address length for ${addr}`);
  const body = buf.subarray(0, 21);
  const chk = buf.subarray(21);
  if (Buffer.compare(Buffer.from(sha256d(body).subarray(0, 4)), Buffer.from(chk)) !== 0) {
    throw new Error(`bad checksum for ${addr}`);
  }
  // body[0] is the type prefix; only 0x00 is an account. Another payload with a valid checksum
  // would still decode to 20 bytes that no account controls.
  if (body[0] !== 0x00)
    throw new Error(`not an XRPL account address (type prefix 0x${body[0]?.toString(16)}): ${addr}`);
  return body.subarray(1);
}

/** 20-byte AccountID → classic `r...` address. */
export function encodeAccountId(accountId: Uint8Array): string {
  if (accountId.length !== 20) throw new Error(`AccountID must be 20 bytes, got ${accountId.length}`);
  const payload = Uint8Array.from([0x00, ...accountId]);
  const full = Uint8Array.from([...payload, ...sha256d(payload).subarray(0, 4)]);
  let n = BigInt(`0x${Buffer.from(full).toString('hex')}`);
  let out = '';
  while (n > 0n) {
    out = XRPL_ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of full) {
    if (b !== 0) break;
    out = XRPL_ALPHABET[0] + out;
  }
  return out;
}

/**
 * Withdraw-auth identity for an XRPL account (scheme 3): the 20-byte AccountID as 0x-hex.
 * This is what the NEAR contract compares its `ripemd160(sha256(publicKey))` against.
 */
export function xrpIdentityBytes(classicAddress: string): Hex {
  return `0x${Buffer.from(decodeAccountId(classicAddress)).toString('hex')}`;
}

/**
 * XRPL currency code for a token symbol.
 *
 * XRPL has two forms: a 3-character ASCII code, or the 160-bit form for anything else — the ASCII
 * bytes left-aligned and zero-padded to 20 bytes. Symbols longer than 3 characters (USDC, RLUSD)
 * MUST use the second, which is also how rippled reports them and what the relay registered:
 *   USDC  → 5553444300000000000000000000000000000000
 *   RLUSD → 524c555344000000000000000000000000000000
 *
 * Derived rather than looked up, so a newly listed IOU cannot silently miss a registry entry.
 */
export function xrpCurrencyCode(symbol: string): string {
  if (symbol.length <= 3) return symbol;
  const ascii = Buffer.from(symbol, 'ascii');
  if (ascii.length > 20) throw new Error(`XRPL currency symbol too long: ${symbol}`);
  // Uppercase: XRPL's canonical form, and how rippled reports it back — the relay registered
  // RLUSD as 524C555344..., so a lowercase code risks a string-compare miss in a token map.
  return Buffer.concat([ascii, Buffer.alloc(20 - ascii.length)])
    .toString('hex')
    .toUpperCase();
}

/**
 * Inverse of {@link xrpIdentityBytes}: a 20-byte AccountID (0x-hex) back to its classic `r…`
 * address. Used when decoding a hub-side identity back into something a user can read or pay.
 */
export function xrpHashToClassicAddress(encoded: string): string {
  const hex = encoded.replace(/^0x/, '');
  if (hex.length !== 40) throw new Error(`XRPL AccountID must be 20 bytes, got ${hex.length / 2}`);
  return encodeAccountId(Uint8Array.from(Buffer.from(hex, 'hex')));
}
