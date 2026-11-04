import { describe, expect, it, vi } from 'vitest';
import { ChainKeys } from '@sodax/types';
import { encodeAddress, encodeRecipient, reverseEncodeAddress } from './shared-utils.js';
import { tronBase58ToHex } from '../services/spoke/tron-utils.js';
import { CARDANO_ADDRESSES, CARDANO_PAYMENT_HASH } from '../services/spoke/cardano-test-vectors.js';

// Every chain counts as MPC-relayed here: relay membership must not choose the recipient encoding.
vi.mock('@sodax/types', async importOriginal => ({
  ...(await importOriginal<typeof import('@sodax/types')>()),
  isMpcRelayChainKey: () => true,
}));

/**
 * A Tron release reads its recipient from `data[0..32]` as `12 zero bytes ‖ 20-byte hash`, so the
 * recipient is the LEFT-PADDED word — not the bare identity that authorizes the withdrawal. The two
 * encodings are different values for the same address; conflating them mis-decodes the payout target.
 */

const TRON_ADDRESS = 'TYQvjFWzc2Cnt91LXnk7UJVii3JVfSm69d';

describe('encodeRecipient — Tron', () => {
  it('left-pads the 20-byte hash into a 32-byte word', () => {
    const recipient = encodeRecipient(ChainKeys.TRON_MAINNET, TRON_ADDRESS);

    expect(recipient).toHaveLength(2 + 64);
    expect(recipient.slice(2, 26)).toBe('0'.repeat(24));
    // The trailing 20 bytes are the address hash: the base58 payload minus its 0x41 version byte.
    expect(recipient.slice(26)).toBe(tronBase58ToHex(TRON_ADDRESS).slice(2));
  });

  it('is NOT the identity encoding, which authorizes rather than receives', () => {
    const identity = encodeAddress(ChainKeys.TRON_MAINNET, TRON_ADDRESS);

    expect(identity).toHaveLength(2 + 40);
    expect(encodeRecipient(ChainKeys.TRON_MAINNET, TRON_ADDRESS)).not.toBe(identity);
    // The identity is the tail of the padded word.
    expect(encodeRecipient(ChainKeys.TRON_MAINNET, TRON_ADDRESS).endsWith(identity.slice(2))).toBe(true);
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
  it('left-pads the 20-byte AccountID into a 32-byte word, as the relay releases to it', () => {
    const identity = encodeAddress(ChainKeys.XRP_MAINNET, XRP_ADDRESS);
    const recipient = encodeRecipient(ChainKeys.XRP_MAINNET, XRP_ADDRESS);

    expect(recipient).toBe(`0x${'00'.repeat(12)}${identity.slice(2)}`);
  });

  it('decodes both the identity and the padded recipient word back to the classic address', () => {
    expect(reverseEncodeAddress(ChainKeys.XRP_MAINNET, encodeAddress(ChainKeys.XRP_MAINNET, XRP_ADDRESS))).toBe(
      XRP_ADDRESS,
    );
    expect(reverseEncodeAddress(ChainKeys.XRP_MAINNET, encodeRecipient(ChainKeys.XRP_MAINNET, XRP_ADDRESS))).toBe(
      XRP_ADDRESS,
    );
  });

  it('rejects a 32-byte word whose padding is not zero', () => {
    const dirty = `0x01${encodeRecipient(ChainKeys.XRP_MAINNET, XRP_ADDRESS).slice(4)}` as const;
    expect(() => reverseEncodeAddress(ChainKeys.XRP_MAINNET, dirty)).toThrow(/Invalid XRP recipient word/);
  });
});

describe('encodeRecipient — EVM MPC relay chains (Monad)', () => {
  const MONAD_ADDRESS = '0x6Be3a4AfBD5983604385BCba71aaA3645918E2E2';

  it('returns the plain 20-byte address, not the padded word', () => {
    // The relay releases a padded word on Monad to the zero address (mainnet tx 0x1992cdac…234d).
    expect(encodeRecipient(ChainKeys.MONAD_MAINNET, MONAD_ADDRESS)).toBe(MONAD_ADDRESS.toLowerCase());
  });

  it('rejects a malformed EVM recipient instead of releasing to it', () => {
    expect(() => encodeRecipient(ChainKeys.MONAD_MAINNET, '0x1234')).toThrow(/invalid EVM recipient/);
    expect(() => encodeRecipient(ChainKeys.MONAD_MAINNET, `0x${'zz'.repeat(20)}`)).toThrow(/invalid EVM recipient/);
  });
});

describe('encodeRecipient — intent relay chains', () => {
  it('leaves a non-MPC chain encoding untouched', () => {
    const evm = '0x1111111111111111111111111111111111111111';
    expect(encodeRecipient(ChainKeys.ARBITRUM_MAINNET, evm)).toBe(encodeAddress(ChainKeys.ARBITRUM_MAINNET, evm));
  });
});

describe('encodeAddress / encodeRecipient / reverseEncodeAddress — Cardano', () => {
  const { enterpriseMainnet, baseMainnet } = CARDANO_ADDRESSES;

  it('identifies an account by its 28-byte payment key hash, whatever its stake part', () => {
    expect(encodeAddress(ChainKeys.CARDANO_MAINNET, enterpriseMainnet.bech32)).toBe(CARDANO_PAYMENT_HASH);
    expect(encodeAddress(ChainKeys.CARDANO_MAINNET, baseMainnet.bech32)).toBe(CARDANO_PAYMENT_HASH);
  });

  it('pays a release to the full raw address, neither the key hash nor a padded word', () => {
    expect(encodeRecipient(ChainKeys.CARDANO_MAINNET, enterpriseMainnet.bech32)).toBe(enterpriseMainnet.hex);
    expect(encodeRecipient(ChainKeys.CARDANO_MAINNET, baseMainnet.bech32)).toBe(baseMainnet.hex);
    expect(encodeRecipient(ChainKeys.CARDANO_MAINNET, baseMainnet.bech32)).toHaveLength(2 + 57 * 2);
  });

  it('decodes the raw recipient bytes back to the bech32 address', () => {
    expect(
      reverseEncodeAddress(ChainKeys.CARDANO_MAINNET, encodeRecipient(ChainKeys.CARDANO_MAINNET, baseMainnet.bech32)),
    ).toBe(baseMainnet.bech32);
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
