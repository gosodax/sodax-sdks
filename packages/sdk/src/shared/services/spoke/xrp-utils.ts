// Byte-identical to the NEAR contract's decoders. The withdraw `sender` (AccountID = ripemd160(sha256(0xED-prefixed
// ed25519 key))) and the submitted `publicKey` differ; the contract derives the former from the latter.
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
  // Only type prefix 0x00 is an account; another checksummed payload would decode to bytes no account controls.
  if (body[0] !== 0x00)
    throw new Error(`not an XRPL account address (type prefix 0x${body[0]?.toString(16)}): ${addr}`);
  return body.subarray(1);
}

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

/** Scheme-3 identity: the 20-byte AccountID the NEAR contract compares `ripemd160(sha256(publicKey))` against. */
export function xrpIdentityBytes(classicAddress: string): Hex {
  return `0x${Buffer.from(decodeAccountId(classicAddress)).toString('hex')}`;
}

/**
 * 3-char ASCII code, else the 160-bit form (ASCII left-aligned, zero-padded to 20 bytes) as rippled reports it.
 * Derived rather than looked up, so a newly listed IOU cannot miss a registry entry.
 */
export function xrpCurrencyCode(symbol: string): string {
  if (symbol.length <= 3) return symbol;
  const ascii = Buffer.from(symbol, 'ascii');
  if (ascii.length > 20) throw new Error(`XRPL currency symbol too long: ${symbol}`);
  // Uppercase as rippled reports it; the relay registered RLUSD as 524C5553…, so lowercase risks a compare miss.
  return Buffer.concat([ascii, Buffer.alloc(20 - ascii.length)])
    .toString('hex')
    .toUpperCase();
}

/**
 * `address` is issuer-only (currency derived from the symbol) or `<40-hex currency>:<issuer>` for issuers of several
 * tokens; the explicit form also keeps ≤3-char tickers on their 160-bit code. Matches the relay's `XRP_TOKEN_MAP` key.
 */
export function xrpTokenRef(token: { address: string; symbol: string }): { currency: string; issuer: string } {
  const sep = token.address.indexOf(':');
  if (sep === -1) return { currency: xrpCurrencyCode(token.symbol), issuer: token.address };
  const currency = token.address.slice(0, sep).toUpperCase();
  const issuer = token.address.slice(sep + 1);
  if (!/^[0-9A-F]{40}$/.test(currency) || currency.startsWith('00')) {
    throw new Error(
      `XRPL token address "${token.address}": the currency before ':' must be 40 hex characters not starting with 00`,
    );
  }
  decodeAccountId(issuer); // throws on anything that is not a valid classic address
  return { currency, issuer };
}

/** Inverse of {@link xrpIdentityBytes}: a 20-byte AccountID (0x-hex) back to its classic `r…` address. */
export function xrpHashToClassicAddress(encoded: string): string {
  const hex = encoded.replace(/^0x/, '');
  if (hex.length !== 40) throw new Error(`XRPL AccountID must be 20 bytes, got ${hex.length / 2}`);
  return encodeAccountId(Uint8Array.from(Buffer.from(hex, 'hex')));
}
