import { describe, expect, it } from 'vitest';
import { ChainKeys } from '@sodax/types';
import { encodeAddress, encodeRecipient, reverseEncodeAddress } from '../../utils/shared-utils.js';
import {
  parseZcashV5Outputs,
  zcashHashToAddress,
  zcashIdentityBytes,
  zcashP2pkhScript,
  zcashZip317Fee,
} from './zcash-utils.js';

const RESERVE = 't1TFab5a31gE6bxzatfs1KSqiportHDCE3X';
const RESERVE_HASH = '0x66e1196f4711a0cb8bdb9b952cd001888295715c';

/** A real, network-accepted mainnet transaction: 1 input, 2 outputs. */
const MAINNET_TX =
  '050000800a27a7265b16a537000000000000000001553c9d9a1699dd2cc2e5625c68b9c105e75aa5e0f38731b8ce51ed4dea281d63010000006b4830450221008336997fe00ee797a1277c9ee6d9fd194447eb1159787545bf55b381a747f73e0220702dd01177e6d72bf53974b6426aa46b3e657ea04aac7bb22d9a7a3451fe2aeb0121028cd25f41a34d2b1c831ec7e6304207bb5018f5a428e7996979e0c46e74780703ffffffff02dc460f00000000001976a9148fce32d0d1961dc116556396b151aa5cdeed88ee88ac44910500000000001976a9144a8c4a21a1cd793ef4bc176fedf70d44f1a8b9ba88ac000000';

describe('transparent addresses', () => {
  it('decodes the live reserve to the hash160 registered on NEAR, and back', () => {
    expect(zcashIdentityBytes(RESERVE)).toBe(RESERVE_HASH);
    expect(zcashHashToAddress(RESERVE_HASH)).toBe(RESERVE);
    expect(zcashIdentityBytes('t1MLBY5zUUo9PVFENPUaHwLREytCvjW4eAU')).toBe(
      '0x25ef2e9496d925b366ddd9348ef2b0820052a191',
    );
  });

  it('refuses a corrupted address rather than paying the wrong script', () => {
    expect(() => zcashIdentityBytes(`${RESERVE.slice(0, -1)}Y`)).toThrow(/checksum/);
  });

  it('builds the P2PKH script for an address', () => {
    expect(zcashP2pkhScript(RESERVE)).toBe(`76a914${RESERVE_HASH.slice(2)}88ac`);
  });
});

describe('address encoding for Zcash', () => {
  it('uses the hash160 as the identity and decodes it back to the t1 address', () => {
    expect(encodeAddress(ChainKeys.ZCASH_MAINNET, RESERVE)).toBe(RESERVE_HASH);
    expect(reverseEncodeAddress(ChainKeys.ZCASH_MAINNET, RESERVE_HASH)).toBe(RESERVE);
  });

  it('pays a release to the zero-padded word the contract decodes', () => {
    // `taddr_pubkey_hash_from_word` asserts the top 12 bytes are zero.
    expect(encodeRecipient(ChainKeys.ZCASH_MAINNET, RESERVE)).toBe(`0x${'00'.repeat(12)}${RESERVE_HASH.slice(2)}`);
  });
});

describe('parseZcashV5Outputs', () => {
  it('reads the outputs of a real mainnet transaction', () => {
    expect(parseZcashV5Outputs(MAINNET_TX)).toEqual([
      { value: 1_001_180n, scriptPubKey: '76a9148fce32d0d1961dc116556396b151aa5cdeed88ee88ac' },
      { value: 364_868n, scriptPubKey: '76a9144a8c4a21a1cd793ef4bc176fedf70d44f1a8b9ba88ac' },
    ]);
  });

  it('refuses a transaction that is not v5', () => {
    expect(() => parseZcashV5Outputs(`04${MAINNET_TX.slice(2)}`)).toThrow(/expected a v5 transaction/);
  });
});

describe('zcashZip317Fee', () => {
  it('charges 5000 zatoshis per logical action, with a floor of two', () => {
    expect(zcashZip317Fee(1, 1)).toBe(10_000n);
    expect(zcashZip317Fee(1, 2)).toBe(10_000n);
    expect(zcashZip317Fee(3, 2)).toBe(15_000n);
  });
});
