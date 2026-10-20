import { describe, expect, it } from 'vitest';
import { ChainKeys } from '@sodax/types';
import { encodeAddress, encodeRecipient } from './shared-utils.js';
import { tronBase58ToHex } from '../services/spoke/tron-utils.js';

/**
 * A hub release reads its recipient from `data[0..32]` as `12 zero bytes ‖ 20-byte hash`, so an
 * MPC-relay chain's recipient is the LEFT-PADDED word — not the bare identity that authorizes the
 * withdrawal. The two encodings are different values for the same address and are not
 * interchangeable; conflating them mis-decodes the payout target.
 */

const TRON_ADDRESS = 'TYQvjFWzc2Cnt91LXnk7UJVii3JVfSm69d';

describe('encodeRecipient — MPC relay chains', () => {
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

describe('encodeRecipient — intent relay chains', () => {
  it('leaves a non-MPC chain encoding untouched', () => {
    const evm = '0x1111111111111111111111111111111111111111';
    // Only the MPC release contract reads the padded word; padding elsewhere would break it.
    expect(encodeRecipient(ChainKeys.ARBITRUM_MAINNET, evm)).toBe(encodeAddress(ChainKeys.ARBITRUM_MAINNET, evm));
  });
});
