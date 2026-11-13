import { ChainKeys, isRealWorldAsset, Sodax, type XToken } from '@sodax/sdk';
import { EvmWalletProvider, robinhoodChain } from '@sodax/wallet-sdk-core';
import { describe, expect, it } from 'vitest';

// The Robinhood Chain pages state these in prose; a change here means the pages need one too.
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const USER = '0x3333333333333333333333333333333333333333';

const sodax = new Sodax();
const swapTokens = sodax.swaps.getSupportedSwapTokensByChainId(ChainKeys.ROBINHOOD_MAINNET);
const mmTokens = sodax.moneyMarket.getSupportedTokensByChainId(ChainKeys.ROBINHOOD_MAINNET);

const bySymbol = (tokens: readonly XToken[], symbol: string) => {
  const token = tokens.find(t => t.symbol === symbol);
  if (!token) throw new Error(`${symbol} is not listed`);
  return token;
};

describe('Robinhood Chain identifiers', () => {
  it("keys the network as 'robinhood' with chain ID 4663", () => {
    expect(ChainKeys.ROBINHOOD_MAINNET).toBe('robinhood');
    expect(robinhoodChain.id).toBe(4663);
  });

  it('exports a viem chain with native ETH (18 decimals) and a Blockscout explorer', () => {
    expect(robinhoodChain.nativeCurrency).toMatchObject({ symbol: 'ETH', decimals: 18 });
    expect(robinhoodChain.blockExplorers.default.name).toBe('Blockscout');
  });

  it("defaults the viem chain's RPC to the public endpoint", () => {
    expect(robinhoodChain.rpcUrls.default.http).toEqual(['https://rpc.mainnet.chain.robinhood.com']);
  });
});

describe('Robinhood Chain token lists', () => {
  it('lists ETH at the zero address and every other asset as a contract address', () => {
    const eth = bySymbol(swapTokens, 'ETH');
    expect(eth.address).toBe(ZERO_ADDRESS);
    expect(swapTokens.filter(t => t.address === ZERO_ADDRESS)).toEqual([eth]);
  });

  it('gives USDG 6 decimals while ETH and bnUSD use 18', () => {
    expect(bySymbol(swapTokens, 'USDG').decimals).toBe(6);
    expect(bySymbol(mmTokens, 'USDG').decimals).toBe(6);
    expect(bySymbol(swapTokens, 'ETH').decimals).toBe(18);
    expect(bySymbol(mmTokens, 'bnUSD').decimals).toBe(18);
  });

  it('keeps the money-market list a subset of the swap list', () => {
    const swapAddresses = new Set(swapTokens.map(t => t.address.toLowerCase()));
    expect(mmTokens.length).toBeGreaterThan(0);
    for (const token of mmTokens) expect(swapAddresses.has(token.address.toLowerCase())).toBe(true);
  });

  it('lists Stock Tokens for swaps only', () => {
    expect(swapTokens.filter(isRealWorldAsset).length).toBeGreaterThan(0);
    expect(mmTokens.filter(isRealWorldAsset)).toEqual([]);
  });
});

describe('Robinhood Chain approvals', () => {
  it('needs no approval to swap native ETH', async () => {
    const eth = bySymbol(swapTokens, 'ETH');
    const allowance = await sodax.swaps.isAllowanceValid({
      params: {
        inputToken: eth.address,
        outputToken: ZERO_ADDRESS,
        inputAmount: 1n,
        minOutputAmount: 0n,
        deadline: 0n,
        allowPartialFill: false,
        srcChainKey: ChainKeys.ROBINHOOD_MAINNET,
        dstChainKey: ChainKeys.BASE_MAINNET,
        srcAddress: USER,
        dstAddress: USER,
        solver: ZERO_ADDRESS,
        data: '0x',
      },
      walletProvider: new EvmWalletProvider({
        privateKey: `0x${'01'.repeat(32)}`, // throwaway key, never funded
        chainId: ChainKeys.ROBINHOOD_MAINNET,
        rpcUrl: 'http://127.0.0.1:1',
      }),
    });
    expect(allowance).toEqual({ ok: true, value: true });
  });

  it.each(['borrow', 'withdraw'] as const)('needs no approval to %s', async action => {
    const usdg = bySymbol(mmTokens, 'USDG');
    const allowance = await sodax.moneyMarket.isAllowanceValid({
      params: { srcChainKey: ChainKeys.ROBINHOOD_MAINNET, srcAddress: USER, token: usdg.address, amount: 1n, action },
    });
    expect(allowance).toEqual({ ok: true, value: true });
  });
});
