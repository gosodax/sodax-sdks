import { describe, expect, it } from 'vitest';
import { sha256 } from 'viem';
import {
  assembleBroadcastHex,
  computeSignedMessageHash,
  encodeTrc20TransferParams,
  spliceMemo,
  tronAddressToWord,
  tronBase58ToHex,
  tronHashToBase58,
  tronIdentityBytes,
  tronRecipientBytes,
} from './tron-utils.js';

// Verified mainnet deposit fixtures (20 TRX → sodaTRX).
const RESERVE = 'TKEsLgfqRdC9PX88hvW1WWnMhH53qCMe92';
const RESERVE_HEX = '4165af5fef4974f67c4421ebb70244d8c485ada423';
const MEMO = 'b07ec4b9c2d410c84fb75cb2cf00122f6316cf191ae1fe7bec45ac203c5e13fd';

describe('tronBase58ToHex', () => {
  it('decodes a base58 Tron address to 41-prefixed hex (checksum stripped)', () => {
    expect(tronBase58ToHex(RESERVE)).toBe(RESERVE_HEX);
  });

  it('passes through 0x / 41-hex forms unchanged', () => {
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

  it('rejects base58 strings of the wrong length', () => {
    expect(() => tronBase58ToHex(RESERVE.slice(0, -1))).toThrow(/25 bytes/);
    expect(() => tronBase58ToHex(`${RESERVE}1`)).toThrow(/25 bytes/);
  });

  it('rejects a valid base58check address with a non-Tron version byte', () => {
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
  it('appends field 10 (tag 0x52, len 0x20) with the memo', () => {
    const out = spliceMemo(raw, MEMO);
    expect(out).toBe(`${raw}5220${MEMO}`);
  });

  it('accepts a 0x-prefixed memo', () => {
    expect(spliceMemo(raw, `0x${MEMO}`)).toBe(`${raw}5220${MEMO}`);
  });

  it('rejects a memo that is not 32 bytes', () => {
    expect(() => spliceMemo(raw, 'dead')).toThrow(/32 bytes/);
  });

  it('produces a raw whose sha256 is a stable 32-byte txID', () => {
    const out = spliceMemo(raw, MEMO);
    const txId = sha256(`0x${out}`).slice(2);
    expect(txId).toHaveLength(64);
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
  it('encodes transfer(address,uint256) args as two 32-byte words with no selector', () => {
    const params = encodeTrc20TransferParams(RESERVE, 20_000_000n);
    expect(params).toHaveLength(128);
    expect(params.slice(0, 64)).toBe(tronAddressToWord(RESERVE));
    expect(BigInt(`0x${params.slice(64)}`)).toBe(20_000_000n);
  });

  it('left-pads the amount to a full word', () => {
    expect(encodeTrc20TransferParams(RESERVE, 1n).slice(64)).toBe(`${'0'.repeat(63)}1`);
  });
});

// ---- withdrawal-auth helpers (KAT vectors from v2/common/tests/wallet-message.test.ts) ----

describe('tronIdentityBytes', () => {
  it('returns the 20-byte address hash (0x41 version byte dropped)', () => {
    expect(tronIdentityBytes('TYQvjFWzc2Cnt91LXnk7UJVii3JVfSm69d')).toBe('0xf62fffa4d92bcdfc310dccbe943747fe8302e871');
  });
});

describe('tronHashToBase58', () => {
  it('inverts tronBase58ToHex (41-prefixed 21-byte hex → base58)', () => {
    expect(tronHashToBase58('4165af5fef4974f67c4421ebb70244d8c485ada423')).toBe('TKEsLgfqRdC9PX88hvW1WWnMhH53qCMe92');
  });
  it('accepts a bare 20-byte hash and round-trips with tronIdentityBytes', () => {
    const b58 = 'TYQvjFWzc2Cnt91LXnk7UJVii3JVfSm69d';
    expect(tronHashToBase58(tronIdentityBytes(b58))).toBe(b58);
  });
});

describe('tronRecipientBytes', () => {
  it('left-pads the 20-byte hash into a 32-byte word (12 zero bytes ‖ hash)', () => {
    expect(tronRecipientBytes('TYQvjFWzc2Cnt91LXnk7UJVii3JVfSm69d')).toBe(
      '0x000000000000000000000000f62fffa4d92bcdfc310dccbe943747fe8302e871',
    );
  });
});

describe('computeSignedMessageHash', () => {
  it('matches the contract compute_message_hash KAT', () => {
    const h = computeSignedMessageHash({
      to: '0x2222222222222222222222222222222222222222',
      data: '0x1234abcd',
      nonce: 5n,
      chainId: 11155111n,
      sender: '0x5A6435B3a4bE2705453Ece84391928483ccBcD94',
    });
    expect(h).toBe('0xc15363b8bfc144961ef308afa1f232017b1d6a02e8665960c2dfa190a987f12e');
  });

  it('changes when the nonce changes (replay-distinct preimage)', () => {
    const base = {
      to: '0x2222222222222222222222222222222222222222',
      data: '0x1234abcd',
      chainId: 728126428n,
      sender: '0xf62fffa4d92bcdfc310dccbe943747fe8302e871',
    } as const;
    expect(computeSignedMessageHash({ ...base, nonce: 1n })).not.toBe(computeSignedMessageHash({ ...base, nonce: 2n }));
  });
});

describe('assembleBroadcastHex', () => {
  it('wraps raw_data (field 1) and a 0x41-prefixed signature (field 2)', () => {
    const raw = 'ab'.repeat(10); // 10 bytes
    const sig = 'cd'.repeat(65); // 65-byte Tron signature
    const env = assembleBroadcastHex(raw, sig);
    // 0a <varint len=10=0x0a> <raw> 12 41 <sig>
    expect(env).toBe(`0a0a${raw}1241${sig}`);
  });

  it('tolerates a 0x-prefixed signature', () => {
    const raw = 'ff';
    const sig = '11'.repeat(65);
    expect(assembleBroadcastHex(raw, `0x${sig}`)).toBe(`0a01${raw}1241${sig}`);
  });
});
