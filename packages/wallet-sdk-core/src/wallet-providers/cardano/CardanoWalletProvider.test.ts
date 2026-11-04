import { describe, expect, it, vi } from 'vitest';
import { CardanoWalletProvider } from './CardanoWalletProvider.js';
import type { CardanoWalletLike } from './types.js';

const ADDRESS = 'addr1vx9jrppy446d7fwntsh23cy55nzutt4jew6yysvnx9tfxychfqm3y';
const SIGNATURE = { signature: '84a0', key: 'a401' };

const makeWallet = () => {
  const wallet = {
    getAddress: vi.fn(async () => ADDRESS),
    signTx: vi.fn(async (_tx: string) => 'a100'),
    submitTx: vi.fn(async (_tx: string) => 'ab'.repeat(32)),
    signData: vi.fn(async (_payload: string) => SIGNATURE),
  } satisfies CardanoWalletLike;
  return { wallet, provider: new CardanoWalletProvider({ wallet }) };
};

describe('CardanoWalletProvider', () => {
  it('is a Cardano provider that reports the wallet address', async () => {
    const { provider } = makeWallet();

    expect(provider.chainType).toBe('CARDANO');
    expect(await provider.getWalletAddress()).toBe(ADDRESS);
  });

  it('hands the wallet a transaction as bare hex CBOR and returns its witness set', async () => {
    const { wallet, provider } = makeWallet();

    expect(await provider.signTransaction('0x84a5')).toBe('a100');
    expect(wallet.signTx).toHaveBeenCalledWith('84a5');
  });

  it('submits a signed transaction as bare hex CBOR and returns the wallet tx hash', async () => {
    const { wallet, provider } = makeWallet();

    expect(await provider.submitTransaction('84a5')).toBe('ab'.repeat(32));
    expect(wallet.submitTx).toHaveBeenCalledWith('84a5');
  });

  it('strips the 0x from a signData payload and returns the DataSignature unchanged', async () => {
    const { wallet, provider } = makeWallet();

    expect(await provider.signData('0x3078')).toBe(SIGNATURE);
    expect(wallet.signData).toHaveBeenCalledWith('3078');
  });

  it('refuses a configuration without a wallet', () => {
    expect(() => new CardanoWalletProvider({} as never)).toThrow(/CIP-30 wallet is required/);
  });
});
