import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { ChainKeys } from '@sodax/types';
import { encodeAddress, encodeRecipient, reverseEncodeAddress } from './shared-utils.js';
import { tronBase58ToHex } from '../services/spoke/tron-utils.js';
import { CARDANO_ADDRESSES, CARDANO_PAYMENT_HASH } from '../services/spoke/cardano-test-vectors.js';

/**
 * A Tron release reads its recipient from `data[0..32]` as `12 zero bytes ‖ 20-byte hash`, so the
 * recipient is the LEFT-PADDED word — not the bare identity that authorizes the withdrawal. The two
 * encodings are different values for the same address; conflating them mis-decodes the payout target.
 */

const TRON_ADDRESS = 'TYQvjFWzc2Cnt91LXnk7UJVii3JVfSm69d';

describe('encodeRecipient — Tron', () => {
  it('left-pads the 20-byte hash into a 32-byte word, which is NOT the identity encoding', () => {
    const recipient = encodeRecipient(ChainKeys.TRON_MAINNET, TRON_ADDRESS);

    expect(recipient).toHaveLength(2 + 64);
    expect(recipient.slice(2, 26)).toBe('0'.repeat(24));
    // The trailing 20 bytes are the address hash: the base58 payload minus its 0x41 version byte.
    expect(recipient.slice(26)).toBe(tronBase58ToHex(TRON_ADDRESS).slice(2));

    // The identity authorizes rather than receives; it is the tail of the padded word.
    const identity = encodeAddress(ChainKeys.TRON_MAINNET, TRON_ADDRESS);
    expect(identity).toHaveLength(2 + 40);
    expect(recipient).not.toBe(identity);
    expect(recipient.endsWith(identity.slice(2))).toBe(true);
  });
});

describe('reverseEncodeAddress — Tron', () => {
  it('decodes both the identity and the padded recipient word back to the base58 address', () => {
    expect(reverseEncodeAddress(ChainKeys.TRON_MAINNET, encodeAddress(ChainKeys.TRON_MAINNET, TRON_ADDRESS))).toBe(
      TRON_ADDRESS,
    );
    expect(reverseEncodeAddress(ChainKeys.TRON_MAINNET, encodeRecipient(ChainKeys.TRON_MAINNET, TRON_ADDRESS))).toBe(
      TRON_ADDRESS,
    );
  });

  it('rejects a 32-byte word whose padding is not zero', () => {
    const word = encodeRecipient(ChainKeys.TRON_MAINNET, TRON_ADDRESS);
    const dirty = `0x01${word.slice(4)}` as const;
    expect(() => reverseEncodeAddress(ChainKeys.TRON_MAINNET, dirty)).toThrow(/Invalid Tron recipient word/);
  });
});

const XRP_ADDRESS = 'rBTwLga3i2gz3doX6Gva3MgEV8ZCD8jjah';

describe('encodeRecipient / reverseEncodeAddress — XRP', () => {
  it('left-pads the 20-byte AccountID into a 32-byte word, and decodes both forms back to the classic address', () => {
    const identity = encodeAddress(ChainKeys.XRP_MAINNET, XRP_ADDRESS);
    const recipient = encodeRecipient(ChainKeys.XRP_MAINNET, XRP_ADDRESS);

    expect(recipient).toBe(`0x${'00'.repeat(12)}${identity.slice(2)}`);
    expect(reverseEncodeAddress(ChainKeys.XRP_MAINNET, identity)).toBe(XRP_ADDRESS);
    expect(reverseEncodeAddress(ChainKeys.XRP_MAINNET, recipient)).toBe(XRP_ADDRESS);
  });

  it('rejects a 32-byte word whose padding is not zero', () => {
    const dirty = `0x01${encodeRecipient(ChainKeys.XRP_MAINNET, XRP_ADDRESS).slice(4)}` as const;
    expect(() => reverseEncodeAddress(ChainKeys.XRP_MAINNET, dirty)).toThrow(/Invalid XRP recipient word/);
  });
});

describe('encodeRecipient — EVM MPC relay chains (Monad)', () => {
  const MONAD_ADDRESS = getAddress('0x6be3a4afbd5983604385bcba71aaa3645918e2e2');

  it('returns the plain lowercased 20-byte address, not the padded word, for checksummed or lowercase input', () => {
    // The relay releases a padded word on Monad to the zero address (mainnet tx 0x1992cdac…234d).
    expect(encodeRecipient(ChainKeys.MONAD_MAINNET, MONAD_ADDRESS)).toBe(MONAD_ADDRESS.toLowerCase());
    expect(encodeRecipient(ChainKeys.MONAD_MAINNET, MONAD_ADDRESS.toLowerCase())).toBe(MONAD_ADDRESS.toLowerCase());
  });

  it('rejects a malformed or EIP-55-invalid EVM recipient instead of releasing to it', () => {
    expect(() => encodeRecipient(ChainKeys.MONAD_MAINNET, '0x1234')).toThrow(/invalid EVM recipient/);
    expect(() => encodeRecipient(ChainKeys.MONAD_MAINNET, `0x${'zz'.repeat(20)}`)).toThrow(/invalid EVM recipient/);
    // The checksum is validated before lowercasing.
    const valid = getAddress('0x1468d3529032106291433b7e9e3026df1ff78f31');
    expect(() => encodeRecipient(ChainKeys.MONAD_MAINNET, `${valid.slice(0, -1)}2`)).toThrow(/invalid EVM recipient/);
  });
});

describe('encodeRecipient — intent relay chains', () => {
  it('leaves a non-MPC chain encoding untouched', () => {
    const evm = getAddress('0x6be3a4afbd5983604385bcba71aaa3645918e2e2');
    expect(evm).not.toBe(evm.toLowerCase());
    expect(encodeRecipient(ChainKeys.ARBITRUM_MAINNET, evm)).toBe(encodeAddress(ChainKeys.ARBITRUM_MAINNET, evm));
  });
});

describe('encodeAddress / encodeRecipient / reverseEncodeAddress — Cardano', () => {
  const { enterpriseMainnet, baseMainnet } = CARDANO_ADDRESSES;

  it('identifies an account by its 28-byte payment key hash, whatever its stake part', () => {
    expect(encodeAddress(ChainKeys.CARDANO_MAINNET, enterpriseMainnet.bech32)).toBe(CARDANO_PAYMENT_HASH);
    expect(encodeAddress(ChainKeys.CARDANO_MAINNET, baseMainnet.bech32)).toBe(CARDANO_PAYMENT_HASH);
  });

  it('pays a release to the full raw address, neither the key hash nor a padded word, and decodes it back', () => {
    expect(encodeRecipient(ChainKeys.CARDANO_MAINNET, enterpriseMainnet.bech32)).toBe(enterpriseMainnet.hex);
    const recipient = encodeRecipient(ChainKeys.CARDANO_MAINNET, baseMainnet.bech32);
    expect(recipient).toBe(baseMainnet.hex);
    expect(recipient).toHaveLength(2 + 57 * 2);
    expect(reverseEncodeAddress(ChainKeys.CARDANO_MAINNET, recipient)).toBe(baseMainnet.bech32);
  });

  it('refuses to decode the key-hash identity, which does not say what stake part the address had', () => {
    expect(() => reverseEncodeAddress(ChainKeys.CARDANO_MAINNET, CARDANO_PAYMENT_HASH)).toThrow(
      /cannot be turned back/,
    );
  });

  it('refuses a testnet recipient rather than pay a different network', () => {
    expect(() => encodeRecipient(ChainKeys.CARDANO_MAINNET, CARDANO_ADDRESSES.enterpriseTestnet.bech32)).toThrow(
      /not mainnet/,
    );
  });
});

describe('reverseEncodeAddress — Zcash', () => {
  const address = 't1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs';

  it('decodes the padded recipient word back to the transparent address', () => {
    expect(reverseEncodeAddress(ChainKeys.ZCASH_MAINNET, encodeRecipient(ChainKeys.ZCASH_MAINNET, address))).toBe(
      address,
    );
  });

  it('rejects nonzero recipient padding', () => {
    const dirty = `0x01${encodeRecipient(ChainKeys.ZCASH_MAINNET, address).slice(4)}` as const;
    expect(() => reverseEncodeAddress(ChainKeys.ZCASH_MAINNET, dirty)).toThrow(/Invalid Zcash recipient word/);
  });
});
