import { ChainKeys, Sodax } from '@sodax/sdk';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bySymbol } from './accept-any-token.js';
import { borrowToNetwork, supplyFromBase } from './lending-spoke.js';

const USER = '0x3333333333333333333333333333333333333333';

const setup = () => ({
  sodax: new Sodax(),
  walletProvider: new EvmWalletProvider({
    privateKey: `0x${'01'.repeat(32)}`, // throwaway key, never funded
    chainId: ChainKeys.BASE_MAINNET,
    rpcUrl: 'http://127.0.0.1:1',
  }),
});

afterEach(() => vi.restoreAllMocks());

describe('supplyFromBase', () => {
  it('supplies the Base money-market token from Base, approving only when short', async () => {
    const { sodax, walletProvider } = setup();
    const mm = sodax.moneyMarket;
    vi.spyOn(mm, 'isAllowanceValid').mockResolvedValue({ ok: true, value: false });
    const approve = vi.spyOn(mm, 'approve').mockResolvedValue({ ok: true, value: '0xabc' });
    const supply = vi
      .spyOn(mm, 'supply')
      .mockResolvedValue({ ok: true, value: { srcChainTxHash: '0xa', dstChainTxHash: '0xb' } });

    await supplyFromBase({ sodax, walletProvider, userBaseAddress: USER, symbol: 'USDC', amount: 100n });

    const baseUsdc = bySymbol(mm.getSupportedTokensByChainId(ChainKeys.BASE_MAINNET), 'USDC');
    expect(approve).toHaveBeenCalledOnce();
    expect(supply.mock.calls[0]?.[0].params).toEqual({
      srcChainKey: ChainKeys.BASE_MAINNET,
      srcAddress: USER,
      token: baseUsdc.address,
      amount: 100n,
      action: 'supply',
    });
  });
});

describe('borrowToNetwork', () => {
  it('acts from Base and takes the token from the destination network list', async () => {
    const { sodax, walletProvider } = setup();
    const mm = sodax.moneyMarket;
    const borrow = vi
      .spyOn(mm, 'borrow')
      .mockResolvedValue({ ok: true, value: { srcChainTxHash: '0xa', dstChainTxHash: '0xb' } });

    await borrowToNetwork({
      sodax,
      walletProvider,
      userBaseAddress: USER,
      dstChainKey: ChainKeys.ARBITRUM_MAINNET,
      dstAddress: USER,
      symbol: 'bnUSD',
      amount: 50n,
    });

    const arbBnUSD = bySymbol(mm.getSupportedTokensByChainId(ChainKeys.ARBITRUM_MAINNET), 'bnUSD');
    expect(borrow.mock.calls[0]?.[0].params).toMatchObject({
      srcChainKey: ChainKeys.BASE_MAINNET,
      dstChainKey: ChainKeys.ARBITRUM_MAINNET,
      token: arbBnUSD.address,
      action: 'borrow',
    });
  });
});
