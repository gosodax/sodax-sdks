import { ChainKeys, Sodax } from '@sodax/sdk';
import { describe, expect, it, vi } from 'vitest';
import { readPortfolio } from './portfolio.js';

describe('readPortfolio', () => {
  it('reports a failed network as null without hiding the others', async () => {
    const sodax = new Sodax();
    vi.spyOn(sodax.swaps, 'getSupportedSwapTokensByChainId').mockReturnValue([]);
    vi.spyOn(sodax.spoke, 'getWalletBalances').mockImplementation(async ({ srcChainKey }) =>
      srcChainKey === ChainKeys.ARBITRUM_MAINNET
        ? { ok: true, value: { '0xabc': 5n } }
        : { ok: false, error: new Error('rpc down') },
    );

    const portfolio = await readPortfolio(sodax, [
      { chainKey: ChainKeys.ARBITRUM_MAINNET, address: '0x1' },
      { chainKey: ChainKeys.BASE_MAINNET, address: '0x1' },
    ]);

    expect(portfolio).toEqual([
      { chainKey: ChainKeys.ARBITRUM_MAINNET, balances: { '0xabc': 5n } },
      { chainKey: ChainKeys.BASE_MAINNET, balances: null },
    ]);
  });
});
