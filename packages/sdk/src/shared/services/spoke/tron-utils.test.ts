import { tronSupportedTokens } from '@sodax/types';
import { describe, expect, it } from 'vitest';
import {
  assembleBroadcastHex,
  assertDepositTransfer,
  encodeTrc20TransferParams,
  readTrc20TransferCall,
  setExpiration,
  spliceMemo,
  tronAddressToWord,
  tronBase58ToHex,
  tronHashToBase58,
  tronIdentityBytes,
} from './tron-utils.js';
import { nativeTransferRaw, pbBytes, pbVarint, trc20TransferRaw, tronRawData } from './tron-test-fixtures.js';

// Verified mainnet deposit fixtures (20 TRX → sodaTRX).
const RESERVE = 'TKEsLgfqRdC9PX88hvW1WWnMhH53qCMe92';
const OWNER = 'TYQvjFWzc2Cnt91LXnk7UJVii3JVfSm69d';
const USDT = tronSupportedTokens.USDT.address;
const RESERVE_HEX = '4165af5fef4974f67c4421ebb70244d8c485ada423';
const MEMO = 'b07ec4b9c2d410c84fb75cb2cf00122f6316cf191ae1fe7bec45ac203c5e13fd';

describe('tronBase58ToHex', () => {
  it('decodes a base58 Tron address to 41-prefixed hex (checksum stripped), passing 0x / 41-hex forms through', () => {
    expect(tronBase58ToHex(RESERVE)).toBe(RESERVE_HEX);
    expect(tronBase58ToHex(`0x${RESERVE_HEX}`)).toBe(RESERVE_HEX);
    expect(tronBase58ToHex(RESERVE_HEX)).toBe(RESERVE_HEX);
  });

  it('rejects invalid base58', () => {
    expect(() => tronBase58ToHex('0OIl-not-base58')).toThrow(/invalid base58/);
  });

  it('rejects a one-character typo that is still valid base58 (checksum mismatch)', () => {
    const typo = `${RESERVE.slice(0, -1)}3`;
    expect(() => tronBase58ToHex(typo)).toThrow(/checksum/);
  });

  it('rejects base58 that is not 25 bytes with a 0x41 version: wrong length, leading zero, non-Tron version', () => {
    expect(() => tronBase58ToHex(RESERVE.slice(0, -1))).toThrow(/25 bytes/);
    expect(() => tronBase58ToHex(`${RESERVE}1`)).toThrow(/25 bytes/);
    expect(() => tronBase58ToHex('1TYQvjFWzc2Cnt91LXnk7UJVii3JVfSm69d')).toThrow(
      'invalid Tron address (expected 25 bytes with 0x41 version)',
    );
    // Bitcoin P2PKH: 25 bytes with a valid checksum, but version 0x00.
    expect(() => tronBase58ToHex('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toThrow(/0x41 version/);
  });

  it('rejects malformed hex forms', () => {
    expect(() => tronBase58ToHex(`0x${RESERVE_HEX.slice(2)}`)).toThrow(/0x41 \+ 20 bytes/); // bare 20-byte hash
    expect(() => tronBase58ToHex(`0x${RESERVE_HEX.slice(0, -2)}`)).toThrow(/0x41 \+ 20 bytes/);
    expect(() => tronBase58ToHex(`0x42${RESERVE_HEX.slice(2)}`)).toThrow(/0x41 \+ 20 bytes/);
  });
});

describe('tronAddressToWord', () => {
  it('right-aligns the 20-byte body in a 32-byte word (0x41 prefix dropped)', () => {
    const word = tronAddressToWord(RESERVE);
    expect(word).toHaveLength(64);
    expect(word).toBe(`000000000000000000000000${RESERVE_HEX.slice(2)}`);
  });
});

describe('spliceMemo', () => {
  // A minimal raw_data with only low-numbered fields (all < 10) so the memo appends at the end.
  const raw = '0a02abcd1a020102'; // field 1 (len2) + field 3 (len2) — both < 10
  it('appends field 10 (tag 0x52, len 0x20) with the memo, 0x-prefixed or not', () => {
    expect(spliceMemo(raw, MEMO)).toBe(`${raw}5220${MEMO}`);
    expect(spliceMemo(raw, `0x${MEMO}`)).toBe(`${raw}5220${MEMO}`);
  });

  it('rejects a memo that is not 32 bytes', () => {
    expect(() => spliceMemo(raw, 'dead')).toThrow(/32 bytes/);
  });

  // A TRC-20 deposit is a TriggerSmartContract, whose `contract` is field 11 — the memo must land
  // BEFORE it to keep the fields in ascending order, not appended at the end like the native case.
  it('inserts the memo ahead of the contract field for a TriggerSmartContract raw', () => {
    const head = '0a02abcd4001'; // field 1 (len2) + field 8 (varint) — both < 10
    const contract = '5a020102'; // field 11 (len2)
    expect(spliceMemo(`${head}${contract}`, MEMO)).toBe(`${head}5220${MEMO}${contract}`);
  });
});

describe('encodeTrc20TransferParams', () => {
  it('encodes transfer(address,uint256) args as two 32-byte words with no selector, amount left-padded', () => {
    const params = encodeTrc20TransferParams(RESERVE, 20_000_000n);
    expect(params).toHaveLength(128);
    expect(params.slice(0, 64)).toBe(tronAddressToWord(RESERVE));
    expect(BigInt(`0x${params.slice(64)}`)).toBe(20_000_000n);
    expect(encodeTrc20TransferParams(RESERVE, 1n).slice(64)).toBe(`${'0'.repeat(63)}1`);
  });
});

// ---- withdrawal-auth helpers (KAT vectors from v2/common/tests/wallet-message.test.ts) ----

describe('tronIdentityBytes / tronHashToBase58', () => {
  it('returns the 20-byte address hash, which tronHashToBase58 inverts as does the 41-prefixed hex', () => {
    const b58 = 'TYQvjFWzc2Cnt91LXnk7UJVii3JVfSm69d';
    expect(tronIdentityBytes(b58)).toBe('0xf62fffa4d92bcdfc310dccbe943747fe8302e871');
    expect(tronHashToBase58(tronIdentityBytes(b58))).toBe(b58);
    expect(tronHashToBase58('4165af5fef4974f67c4421ebb70244d8c485ada423')).toBe('TKEsLgfqRdC9PX88hvW1WWnMhH53qCMe92');
  });
});

describe('assembleBroadcastHex', () => {
  it('wraps raw_data (field 1) and a 0x41-prefixed signature (field 2), 0x-prefixed or not', () => {
    const raw = 'ab'.repeat(10); // 10 bytes
    const sig = 'cd'.repeat(65); // 65-byte Tron signature
    // 0a <varint len=10=0x0a> <raw> 12 41 <sig>
    expect(assembleBroadcastHex({ rawHex: raw, signatures: [sig] })).toBe(`0a0a${raw}1241${sig}`);
    expect(assembleBroadcastHex({ rawHex: raw, signatures: [`0x${sig}`] })).toBe(`0a0a${raw}1241${sig}`);
  });

  it('gives each signature of a multi-signature account its own field, and a long body a two-byte length', () => {
    const raw = 'ab'.repeat(200); // 200 = 0xc8: varint `c8 01`
    const [a, b] = ['cd'.repeat(65), 'ef'.repeat(65)];
    expect(assembleBroadcastHex({ rawHex: raw, signatures: [a, b] })).toBe(`0ac801${raw}1241${a}1241${b}`);
  });
});

describe('setExpiration', () => {
  const OTHER = 'TYBNgWfhGuNzdLtjKtxXTfskAhTbMcqbaG';
  const value = pbBytes(1, tronBase58ToHex(OWNER)) + pbBytes(2, tronBase58ToHex(OTHER)) + pbVarint(3, 7n);
  const EXPIRATION = 1_800_000_000_000n; // ms; a multi-byte varint

  it('replaces the expiration field and leaves every other field as it was, memo included', () => {
    const before = spliceMemo(tronRawData(1n, 'TransferContract', value), MEMO);
    const after = spliceMemo(tronRawData(1n, 'TransferContract', value, undefined, EXPIRATION), MEMO);

    expect(setExpiration({ rawHex: before, expiration: Number(EXPIRATION) })).toBe(after);
  });

  it('refuses a body with no expiration field, or two', () => {
    for (const raw of [
      pbBytes(1, 'abcd') + pbBytes(11, pbVarint(1, 1n)),
      pbVarint(8, 1n) + tronRawData(1n, 'TransferContract', value),
    ]) {
      expect(() => setExpiration({ rawHex: raw, expiration: Number(EXPIRATION) })).toThrow(
        /expected one expiration field/,
      );
    }
  });
});

describe('assertDepositTransfer', () => {
  const OTHER = 'TYBNgWfhGuNzdLtjKtxXTfskAhTbMcqbaG';
  const AMOUNT = 5_000_000_000n; // above 2^31 sun, so a 32-bit varint read would misjudge it
  const native = { owner: OWNER, reserve: RESERVE, amount: AMOUNT, maxFeeLimitSun: 100_000_000 };
  const trc20 = { ...native, token: USDT };
  const transferValue = (to: string, amount: bigint) =>
    pbBytes(1, tronBase58ToHex(OWNER)) + pbBytes(2, tronBase58ToHex(to)) + pbVarint(3, amount);

  it('accepts the exact native and TRC-20 transfers the SDK requested', () => {
    expect(() => assertDepositTransfer(nativeTransferRaw(OWNER, RESERVE, AMOUNT), native)).not.toThrow();
    expect(() => assertDepositTransfer(trc20TransferRaw(OWNER, USDT, RESERVE, AMOUNT), trc20)).not.toThrow();
  });

  it.each([
    ['another owner', nativeTransferRaw(OTHER, RESERVE, AMOUNT), /owner/],
    ['another recipient', nativeTransferRaw(OWNER, OTHER, AMOUNT), /recipient/],
    ['another amount', nativeTransferRaw(OWNER, RESERVE, AMOUNT + 1n), /amount/],
    ['a smart-contract call', trc20TransferRaw(OWNER, USDT, RESERVE, AMOUNT), /TransferContract/],
    ['a pre-set data field', `${pbBytes(10, 'ff')}${nativeTransferRaw(OWNER, RESERVE, AMOUNT)}`, /data field/],
    ['a second contract', nativeTransferRaw(OWNER, RESERVE, AMOUNT) + pbBytes(11, pbVarint(1, 1n)), /one contract/],
    // Protobuf keeps the last value of a repeated scalar, so a trailing duplicate could redirect silently.
    [
      'a duplicated recipient',
      tronRawData(1n, 'TransferContract', transferValue(RESERVE, AMOUNT) + pbBytes(2, tronBase58ToHex(OTHER))),
      /appears 2 times/,
    ],
  ])('rejects a native deposit with %s', (_label, raw, reason) => {
    expect(() => assertDepositTransfer(raw, native)).toThrow(reason);
  });

  it.each([
    ['another token', trc20TransferRaw(OWNER, OTHER, RESERVE, AMOUNT), /deposit token/],
    ['another amount', trc20TransferRaw(OWNER, USDT, RESERVE, 1n), /calldata/],
    ['a fee limit above budget', trc20TransferRaw(OWNER, USDT, RESERVE, AMOUNT, 100_000_001n), /fee_limit/],
    [
      'attached TRX',
      tronRawData(
        31n,
        'TriggerSmartContract',
        pbBytes(1, tronBase58ToHex(OWNER)) +
          pbBytes(2, tronBase58ToHex(USDT)) +
          pbVarint(3, 1n) +
          pbBytes(4, `a9059cbb${encodeTrc20TransferParams(RESERVE, AMOUNT)}`),
      ),
      /call_value/,
    ],
  ])('rejects a TRC-20 deposit with %s', (_label, raw, reason) => {
    expect(() => assertDepositTransfer(raw, trc20)).toThrow(reason);
  });
});

describe('readTrc20TransferCall', () => {
  it('reads the owner, token and transfer arguments of a TRC-20 deposit, memo or not, and undefined for native TRX', () => {
    const raw = trc20TransferRaw(OWNER, USDT, RESERVE, 7n);
    const expected = {
      owner: OWNER,
      contract: USDT,
      parameter: encodeTrc20TransferParams(RESERVE, 7n),
    };

    expect(readTrc20TransferCall(raw)).toEqual(expected);
    expect(readTrc20TransferCall(spliceMemo(raw, MEMO))).toEqual(expected);
    expect(readTrc20TransferCall(nativeTransferRaw(OWNER, RESERVE, 7n))).toBeUndefined();
  });

  it.each([
    [
      'a contract call other than transfer',
      tronRawData(31n, 'TriggerSmartContract', pbBytes(4, 'deadbeef')),
      /not a TRX or TRC-20 transfer/,
    ],
    [
      'another contract type',
      tronRawData(2n, 'TransferAssetContract', pbVarint(3, 1n)),
      /not a TRX or TRC-20 transfer/,
    ],
    ['two contracts', nativeTransferRaw(OWNER, RESERVE, 7n) + pbBytes(11, pbVarint(1, 1n)), /one contract/],
  ])('throws for %s', (_label, raw, reason) => {
    expect(() => readTrc20TransferCall(raw)).toThrow(reason);
  });
});
