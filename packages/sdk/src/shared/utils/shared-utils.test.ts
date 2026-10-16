/**
 * ICON address validation in `encodeAddress` (SWAP-M-1).
 *
 * The ICON branch previously hex-decoded without validating type or length: `Buffer.from(str, 'hex')`
 * silently truncates at the first non-hex char, and the old unanchored `.replace()` rewrote any
 * `hx`/`cx` occurring inside the body, so a malformed destination could slip into an intent. These
 * tests lock in that valid `hx`/`cx` addresses round-trip through `encodeAddress`/`reverseEncodeAddress`
 * and that malformed inputs are rejected before encoding.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainKeys } from '@sodax/types';
import { toHex } from 'viem';
import {
  encodeAddress,
  encodeTokenIdentifier,
  getRandomBytes,
  randomUint256,
  reverseEncodeAddress,
} from './shared-utils.js';

const ICON_MAINNET = ChainKeys.ICON_MAINNET;

const HX = 'hx0000000000000000000000000000000000000001';
const CX = 'cx1111111111111111111111111111111111111111';

describe('encodeAddress (ICON)', () => {
  it('encodes a valid hx address with the 00 version byte and round-trips', () => {
    const encoded = encodeAddress(ICON_MAINNET, HX);
    expect(encoded).toBe(`0x00${HX.slice(2)}`);
    expect(reverseEncodeAddress(ICON_MAINNET, encoded)).toBe(HX);
  });

  it('encodes a valid cx address with the 01 version byte and round-trips', () => {
    const encoded = encodeAddress(ICON_MAINNET, CX);
    expect(encoded).toBe(`0x01${CX.slice(2)}`);
    expect(reverseEncodeAddress(ICON_MAINNET, encoded)).toBe(CX);
  });

  it.each([
    ['bare prefix', 'hx'],
    ['non-hex body', 'hxZZZ0000000000000000000000000000000000000'],
    ['truncated body', 'hx000000000000000000000000000000000000001'],
    ['over-length body', 'hx00000000000000000000000000000000000000011'],
    ['missing prefix', '0000000000000000000000000000000000000001'],
    ['wrong prefix', 'ax0000000000000000000000000000000000000001'],
    ['empty string', ''],
  ])('rejects a malformed ICON address (%s)', (_label, address) => {
    expect(() => encodeAddress(ICON_MAINNET, address)).toThrow(/Invalid ICON address/);
  });
});

/**
 * Destination validation in `encodeAddress` (BRIDGE-M-2). EVM previously passed any string
 * through as Hex (a wrong-length recipient ABI-encodes cleanly, the hub burns the tokens, and
 * the spoke reverts with no refund path); BITCOIN/NEAR/INJECTIVE utf-8-encoded any garbage.
 * These lock in fail-closed validation while keeping the wire encoding itself unchanged.
 */
describe('encodeAddress destination validation (BRIDGE-M-2)', () => {
  const utf8Hex = (address: string) => toHex(Buffer.from(address, 'utf-8'));

  it('passes a valid EVM spoke recipient through unchanged', () => {
    const evm = '0x1468d3529032106291433B7e9e3026dF1Ff78F31';
    expect(encodeAddress(ChainKeys.BASE_MAINNET, evm)).toBe(evm);
  });

  it.each([
    ['wrong length (the stranded-funds case)', '0x1234'],
    ['39 hex chars', `0x${'a'.repeat(39)}`],
    ['41 hex chars', `0x${'a'.repeat(41)}`],
    ['missing 0x prefix', '1468d3529032106291433B7e9e3026dF1Ff78F31'],
    ['non-hex body', '0xZZ68d3529032106291433B7e9e3026dF1Ff78F31'],
    ['empty string', ''],
    // The mistyped-recipient case: right length, right alphabet, one character off.
    ['mixed case failing its EIP-55 checksum', '0x1468d3529032106291433B7e9e3026dF1Ff78F32'],
  ])('rejects a malformed EVM recipient (%s)', (_label, address) => {
    expect(() => encodeAddress(ChainKeys.BASE_MAINNET, address)).toThrow(/Invalid EVM address/);
  });

  it.each([
    ['P2WPKH', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'],
    ['P2TR', 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0'],
    ['P2PKH', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'],
    ['P2SH', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'],
  ])('utf-8 encodes a checksum-valid Bitcoin recipient (%s)', (_label, address) => {
    expect(encodeAddress(ChainKeys.BITCOIN_MAINNET, address)).toBe(utf8Hex(address));
  });

  it.each([
    ['bad Base58Check checksum', '1BoatSLRHtKNngkdXEeobR76b53LETtpyt'],
    ['bad bech32 checksum', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5'],
    ['other bech32 chain', 'inj1cml96vmptgw99syqrrz8az79xer2pcgp0a885r'],
    ['garbage', '0x1234'],
    ['empty string', ''],
  ])('rejects a malformed Bitcoin recipient (%s)', (_label, address) => {
    expect(() => encodeAddress(ChainKeys.BITCOIN_MAINNET, address)).toThrow(/Invalid Bitcoin address/);
  });

  // bech32 is case-insensitive (BIP-173), and these bytes derive the user's hub wallet — the two
  // cases of one address must not encode differently. Base58Check is case-sensitive, so it stands.
  it.each([
    ['P2WPKH', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'],
    ['P2TR', 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0'],
  ])('encodes an uppercase bech32 recipient to its lowercase bytes (%s)', (_label, address) => {
    expect(encodeAddress(ChainKeys.BITCOIN_MAINNET, address.toUpperCase())).toBe(utf8Hex(address));
  });

  it.each([
    ['P2PKH', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'],
    ['P2SH', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'],
  ])('leaves a case-sensitive Base58Check recipient untouched (%s)', (_label, address) => {
    expect(encodeAddress(ChainKeys.BITCOIN_MAINNET, address)).toBe(utf8Hex(address));
  });

  it.each([
    ['named account', 'alice.near'],
    ['top-level account', 'aurora'],
    ['implicit account', 'f'.repeat(64)],
    ['separators', 'sub_1-a.alice.near'],
  ])('utf-8 encodes a valid NEAR account id (%s)', (_label, address) => {
    expect(encodeAddress(ChainKeys.NEAR_MAINNET, address)).toBe(utf8Hex(address));
  });

  it.each([
    ['uppercase', 'Alice.near'],
    ['too short', 'a'],
    ['over 64 chars', 'a'.repeat(65)],
    ['consecutive dots', 'alice..near'],
    ['trailing separator', 'alice-.near'],
    ['empty string', ''],
  ])('rejects a malformed NEAR account id (%s)', (_label, address) => {
    expect(() => encodeAddress(ChainKeys.NEAR_MAINNET, address)).toThrow(/Invalid NEAR account id/);
  });

  it.each([
    ['Injective docs address', 'inj1cml96vmptgw99syqrrz8az79xer2pcgp0a885r'],
    ['bech32-generated vector', 'inj1gfpyysjzgfpyysjzgfpyysjzgfpyysjzgcuxkp'],
    ['32-byte CosmWasm contract', 'inj1zut3w9chzut3w9chzut3w9chzut3w9chzut3w9chzut3w9chzutsme2qam'],
  ])('utf-8 encodes a checksum-valid Injective recipient (%s)', (_label, address) => {
    expect(encodeAddress(ChainKeys.INJECTIVE_MAINNET, address)).toBe(utf8Hex(address));
  });

  it.each([
    ['other bech32 prefix', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'],
    ['wrong data length', 'inj1cml96vmptgw99syqrrz8az79xer2pcgp'],
    ['bech32-invalid chars', 'inj1cml96vmptgw99syqrrz8az79xer2pcgp0a88bo'],
    ['in-charset single-char typo (checksum)', 'inj1cml96vmptgw99syqrrz8az79xer2pcgp0a885q'],
    ['uppercase', 'INJ1CML96VMPTGW99SYQRRZ8AZ79XER2PCGP0A885R'],
    ['empty string', ''],
  ])('rejects a malformed Injective recipient (%s)', (_label, address) => {
    expect(() => encodeAddress(ChainKeys.INJECTIVE_MAINNET, address)).toThrow(/Invalid Injective address/);
  });
});

/**
 * Token identifiers vs recipient addresses (bot-review-2 R1). On BITCOIN/NEAR/INJECTIVE the
 * configured token identifiers are not addresses; routing them through `encodeAddress`'s recipient
 * validators broke default deposit simulation. `encodeTokenIdentifier` keeps identifier semantics
 * for those families and delegates every other family to the validated path.
 */
describe('encodeTokenIdentifier (BOT-R1)', () => {
  const utf8Hex = (value: string) => toHex(Buffer.from(value, 'utf-8'));

  // Real configured identifiers — the exact values the default simulation path feeds through.
  it.each([
    [ChainKeys.BITCOIN_MAINNET, '0:0'],
    [ChainKeys.BITCOIN_MAINNET, '897442:43'],
    [ChainKeys.INJECTIVE_MAINNET, 'inj'],
    [ChainKeys.INJECTIVE_MAINNET, 'factory/inj1d036ftaatxpkqsu9hja8r24rv3v33chz3appxp/bnUSD'],
    [ChainKeys.NEAR_MAINNET, 'NEAR'],
  ])('utf-8 encodes the configured identifier (%s %s)', (chainKey, token) => {
    expect(encodeTokenIdentifier(chainKey, token)).toBe(utf8Hex(token));
    // Companion: the RECIPIENT validators must keep rejecting these — the split is the fix.
    expect(() => encodeAddress(chainKey, token)).toThrow(/Invalid/);
  });

  it('delegates every other family to the validated encodeAddress path', () => {
    const evm = '0x1468d3529032106291433B7e9e3026dF1Ff78F31';
    expect(encodeTokenIdentifier(ChainKeys.BASE_MAINNET, evm)).toBe(evm);
    expect(() => encodeTokenIdentifier(ChainKeys.BASE_MAINNET, 'not-a-token')).toThrow(/Invalid EVM address/);
  });
});

/**
 * getRandomBytes / randomUint256 must use a CSPRNG (SWAP-M-2). The old
 * implementation filled bytes with Math.random (non-CSPRNG); these lock in that
 * the bytes come from crypto.getRandomValues and never from Math.random.
 */
describe('getRandomBytes / randomUint256 (CSPRNG)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a Uint8Array of the requested length', () => {
    expect(getRandomBytes(32)).toBeInstanceOf(Uint8Array);
    expect(getRandomBytes(32)).toHaveLength(32);
    expect(getRandomBytes(0)).toHaveLength(0);
  });

  it('sources bytes from crypto.getRandomValues, not Math.random', () => {
    const cryptoSpy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const mathSpy = vi.spyOn(Math, 'random');
    getRandomBytes(32);
    expect(cryptoSpy).toHaveBeenCalledTimes(1);
    expect(mathSpy).not.toHaveBeenCalled();
  });

  it('randomUint256 hex-encodes the 32 CSPRNG bytes into a bigint', () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => {
      (array as Uint8Array).fill(0xff);
      return array;
    });
    expect(randomUint256()).toBe(2n ** 256n - 1n);
  });

  it('randomUint256 stays within the uint256 range', () => {
    const value = randomUint256();
    expect(value).toBeGreaterThanOrEqual(0n);
    expect(value).toBeLessThan(2n ** 256n);
  });
});
