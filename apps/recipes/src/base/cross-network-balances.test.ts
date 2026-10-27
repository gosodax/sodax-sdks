import { ChainKeys, Sodax } from '@sodax/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatAmount, readPortfolio } from './cross-network-balances.js';

afterEach(() => vi.restoreAllMocks());

describe('readPortfolio', () => {
  it('reads each network with its own swap-supported tokens and reports a failed network as null', async () => {
    const sodax = new Sodax();
    const read = vi
      .spyOn(sodax.spoke, 'getWalletBalances')
      .mockImplementation(async ({ srcChainKey }) =>
        srcChainKey === ChainKeys.BASE_MAINNET
          ? { ok: true, value: { '0xtoken': 5n } }
          : { ok: false, error: new Error('rpc down') },
      );

    const results = await Promise.all(
      readPortfolio(sodax, [
        { chainKey: ChainKeys.BASE_MAINNET, address: '0xuser' },
        { chainKey: ChainKeys.ARBITRUM_MAINNET, address: '0xuser' },
      ]),
    );

    expect(results).toEqual([
      { chainKey: ChainKeys.BASE_MAINNET, balances: { '0xtoken': 5n } },
      { chainKey: ChainKeys.ARBITRUM_MAINNET, balances: null },
    ]);
    expect(read.mock.calls[1]?.[0].tokens).toEqual(
      sodax.swaps.getSupportedSwapTokensByChainId(ChainKeys.ARBITRUM_MAINNET),
    );
  });
});

describe('formatAmount', () => {
  it.each([
    [25_000_000n, 6, '25'],
    [1_500_000n, 6, '1.5'],
    [1n, 18, '0.000000000000000001'],
    [0n, 6, '0'],
    [123n, 0, '123'],
  ])('%s at %i decimals is %s', (value, decimals, expected) => {
    expect(formatAmount(value, decimals)).toBe(expected);
  });
});
