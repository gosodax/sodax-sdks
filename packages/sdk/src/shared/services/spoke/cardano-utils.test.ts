import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { decodeCbor } from './cardano-cbor.js';
import {
  cardanoAddressFromRecipientBytes,
  cardanoDepositMetadata,
  cardanoIdentityBytes,
  cardanoRecipientBytes,
  cardanoSignDataFields,
  cardanoSignDataPayload,
  parseCardanoAddress,
} from './cardano-utils.js';
import { computeSignedMessageHash } from './mpc-message.js';
import {
  CARDANO_ADDRESSES,
  CARDANO_CIP8,
  CARDANO_PAYMENT_HASH,
  CARDANO_MEMO_DEPOSIT,
  CARDANO_REJECTED_ADDRESSES,
} from './cardano-test-vectors.js';

const hex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s.replace(/^0x/, ''), 'hex'));

describe('cardano addresses', () => {
  it('parses enterprise (29-byte) and base (57-byte) mainnet addresses to the same payment key hash', () => {
    const enterprise = parseCardanoAddress(CARDANO_ADDRESSES.enterpriseMainnet.bech32);
    expect(enterprise.kind).toBe('enterprise');
    expect(enterprise.bytes).toHaveLength(29);
    expect(Buffer.from(enterprise.bytes).toString('hex')).toBe(CARDANO_ADDRESSES.enterpriseMainnet.hex.slice(2));
    expect(Buffer.from(enterprise.paymentHash).toString('hex')).toBe(CARDANO_PAYMENT_HASH.slice(2));

    const base = parseCardanoAddress(CARDANO_ADDRESSES.baseMainnet.bech32);
    expect(base.kind).toBe('base');
    expect(base.bytes).toHaveLength(57);
    expect(Buffer.from(base.paymentHash).toString('hex')).toBe(CARDANO_PAYMENT_HASH.slice(2));
  });

  it('pays the full raw address bytes, identifies by payment key hash and round-trips to bech32', () => {
    for (const { hex: raw, bech32 } of [CARDANO_ADDRESSES.enterpriseMainnet, CARDANO_ADDRESSES.baseMainnet]) {
      expect(cardanoRecipientBytes(bech32)).toBe(raw);
      expect(cardanoIdentityBytes(bech32)).toBe(CARDANO_PAYMENT_HASH);
      expect(cardanoAddressFromRecipientBytes(raw)).toBe(bech32);
    }
  });

  it.each([
    ['a script payment credential', CARDANO_REJECTED_ADDRESSES.enterpriseScript, /script payment credential/],
    ['a reward address', CARDANO_REJECTED_ADDRESSES.reward, /reward \(stake\)/],
    ['a pointer address', CARDANO_REJECTED_ADDRESSES.pointer, /pointer addresses/],
    ['a Byron address', CARDANO_REJECTED_ADDRESSES.byron, /Byron/],
  ])('refuses %s', (_label, address, message) => {
    expect(() => parseCardanoAddress(address)).toThrow(message);
  });

  it('refuses testnet, garbage, an oversized string and a wrong-length payload before paying anything', () => {
    expect(() => parseCardanoAddress(CARDANO_ADDRESSES.enterpriseTestnet.bech32)).toThrow(/not mainnet/);
    expect(() => cardanoAddressFromRecipientBytes(CARDANO_ADDRESSES.enterpriseTestnet.hex)).toThrow(
      /network id 0 is not mainnet/,
    );
    expect(() => parseCardanoAddress('not-an-address')).toThrow(/invalid Cardano bech32/);
    expect(() => parseCardanoAddress('addr1'.padEnd(201, 'q'))).toThrow(/above the 200-character limit/);
    // A 28-byte identity is not a recipient: it carries no header and cannot be paid.
    expect(() => cardanoAddressFromRecipientBytes(CARDANO_PAYMENT_HASH)).toThrow(/Cardano/);
  });
});

describe('cardanoDepositMetadata', () => {
  it('attaches the payload hash under CIP-20 label 674 as 64 bare lowercase hex from any prefix or case, and only 32 bytes', () => {
    expect(cardanoDepositMetadata(CARDANO_MEMO_DEPOSIT.payloadHash)).toEqual(CARDANO_MEMO_DEPOSIT.metadata);
    const bare = CARDANO_MEMO_DEPOSIT.payloadHash.slice(2);
    expect(cardanoDepositMetadata(bare.toUpperCase())).toEqual(CARDANO_MEMO_DEPOSIT.metadata);
    expect(cardanoDepositMetadata(`0X${bare}`)).toEqual(CARDANO_MEMO_DEPOSIT.metadata);
    // CIP-20 would truncate anything longer, and the relay would not match anything else.
    expect(() => cardanoDepositMetadata('0x1234')).toThrow(/32 bytes/);
    expect(() => cardanoDepositMetadata(`0x${'zz'.repeat(32)}`)).toThrow(/32 bytes/);
  });
});

describe('cardano withdraw-auth', () => {
  const { message, messageHash } = CARDANO_CIP8;

  it('hashes the withdraw message as the relay does for chain id 1815, and signs the readable 66-byte 0x<hash>', () => {
    expect(computeSignedMessageHash({ ...message, chainId: message.chainId })).toBe(messageHash);
    expect(cardanoSignDataPayload(messageHash)).toBe(CARDANO_CIP8.payloadHex);
    expect(hex(cardanoSignDataPayload(messageHash))).toHaveLength(66);
    expect(() => cardanoSignDataPayload(messageHash.slice(2) as Hex)).toThrow(/0x-prefixed/);
  });

  const valid = { signature: CARDANO_CIP8.coseSign1, key: CARDANO_CIP8.coseSigner };

  it('turns a wallet signData result, tagged 18 or not, into the signature and COSE fields for the relay', () => {
    const fields = cardanoSignDataFields(valid, messageHash, CARDANO_CIP8.paymentHash);

    expect(fields.signature).toBe(CARDANO_CIP8.signature);
    expect(fields.cardanoSignData).toEqual({
      coseSign1: `0x${CARDANO_CIP8.coseSign1}`,
      coseKey: `0x${CARDANO_CIP8.coseSigner}`,
    });

    const tagged = { ...valid, signature: `d2${CARDANO_CIP8.coseSign1}` };
    expect(cardanoSignDataFields(tagged, messageHash, CARDANO_CIP8.paymentHash).signature).toBe(CARDANO_CIP8.signature);
  });

  it('refuses a payload other than the unhashed 0x<hash> and a key other than the withdraw sender', () => {
    const otherHash = `0x${'11'.repeat(32)}` as Hex;
    expect(() => cardanoSignDataFields(valid, otherHash, CARDANO_CIP8.paymentHash)).toThrow(/payload other than/);
    expect(() => cardanoSignDataFields(valid, messageHash, CARDANO_PAYMENT_HASH)).toThrow(
      new RegExp(`signed with payment key hash ${CARDANO_CIP8.paymentHash}`),
    );
  });

  it.each([
    ['empty COSE_Sign1', { ...valid, signature: '' }, /COSE_Sign1 must be non-empty hex/],
    ['an oversized COSE_Key', { ...valid, key: 'aa'.repeat(129) }, /above the 128-byte limit/],
    ['a truncated COSE_Sign1', { ...valid, signature: CARDANO_CIP8.coseSign1.slice(0, 40) }, /COSE_Sign1 malformed/],
    ['a COSE_Sign1 that is not an array of 4', { ...valid, signature: '83010203' }, /array of 4 items/],
    ['a COSE_Key that is not a map', { ...valid, key: '8101' }, /COSE_Key malformed: expected a map/],
    ['a COSE_Key without a 32-byte public key', { ...valid, key: 'a121410a' }, /32-byte ed25519 public key/],
  ])('refuses %s', (_label, dataSignature, message) => {
    expect(() => cardanoSignDataFields(dataSignature, messageHash, CARDANO_CIP8.paymentHash)).toThrow(message);
  });
});

describe('cardano CBOR decoder', () => {
  it('decodes integers, byte and text strings, arrays and maps', () => {
    expect(decodeCbor(hex('a2 01 20 63 616263 82 01 40'.replace(/ /g, '')))).toEqual(
      new Map<bigint | string, unknown>([
        [1n, -1n],
        ['abc', [1n, new Uint8Array()]],
      ]),
    );
  });

  it.each([
    ['an indefinite-length array', '9f01ff', /indefinite lengths/],
    ['trailing bytes', '0100', /trailing bytes/],
    ['a duplicate map key', 'a201010102', /duplicate CBOR map key/],
    ['a tag below the top level', '81d21800', /unsupported CBOR tag/],
    ['nesting deeper than 4', '8181818181818100', /nesting deeper/],
    ['a length that overruns the input', '5a000000ff00', /overruns/],
    ['an unsupported simple value', 'f7', /initial byte 0xf7/],
  ])('refuses %s', (_label, input, message) => {
    expect(() => decodeCbor(hex(input))).toThrow(message);
  });
});
