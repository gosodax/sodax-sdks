import { ChainKeys, Sodax, SolverIntentStatusCode } from '@sodax/sdk';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptAnyToken, bySymbol, waitForSettlement } from './accept-any-token.js';

const HUB_TX = '0x1111111111111111111111111111111111111111111111111111111111111111';
const APP = '0x2222222222222222222222222222222222222222';

function setup(allowanceOk: boolean) {
  const sodax = new Sodax();
  const walletProvider = new EvmWalletProvider({
    privateKey: `0x${'01'.repeat(32)}`, // throwaway key, never funded
    chainId: ChainKeys.ARBITRUM_MAINNET,
    rpcUrl: 'http://127.0.0.1:1',
  });
  const swaps = sodax.swaps;
  vi.spyOn(swaps, 'getQuote').mockResolvedValue({ ok: true, value: { quoted_amount: 1_000_000n } });
  vi.spyOn(swaps, 'getSwapDeadline').mockResolvedValue({ ok: true, value: 999n });
  vi.spyOn(swaps, 'isAllowanceValid').mockResolvedValue({ ok: true, value: allowanceOk });
  const approve = vi.spyOn(swaps, 'approve').mockResolvedValue({ ok: true, value: '0xabc' });
  const swap = vi.spyOn(swaps, 'swap').mockResolvedValue({
    ok: true,
    value: { intentDeliveryInfo: { dstTxHash: HUB_TX } },
  } as Awaited<ReturnType<typeof swaps.swap>>);
  return { sodax, walletProvider, approve, swap };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('acceptAnyToken', () => {
  it('resolves both tokens from config and settles on Base at the app address', async () => {
    const { sodax, walletProvider, swap } = setup(true);
    const hubTx = await acceptAnyToken({
      sodax,
      walletProvider,
      payChainKey: ChainKeys.ARBITRUM_MAINNET,
      paySymbol: 'USDC',
      payAmount: 25_000_000n,
      settleSymbol: 'USDC',
      appBaseAddress: APP,
    });

    expect(hubTx).toBe(HUB_TX);
    const { params } = swap.mock.calls[0]?.[0] ?? {};
    const baseUsdc = bySymbol(sodax.swaps.getSupportedSwapTokensByChainId(ChainKeys.BASE_MAINNET), 'USDC');
    expect(params).toMatchObject({
      srcChainKey: ChainKeys.ARBITRUM_MAINNET,
      dstChainKey: ChainKeys.BASE_MAINNET,
      dstAddress: APP,
      outputToken: baseUsdc.address,
      minOutputAmount: 990_000n,
      deadline: 999n,
    });
  });

  it('approves only when the allowance is short', async () => {
    const enough = setup(true);
    await acceptAnyToken({
      ...enough,
      payChainKey: ChainKeys.ARBITRUM_MAINNET,
      paySymbol: 'USDC',
      payAmount: 1n,
      settleSymbol: 'USDC',
      appBaseAddress: APP,
    });
    expect(enough.approve).not.toHaveBeenCalled();
    vi.restoreAllMocks();

    const short = setup(false);
    await acceptAnyToken({
      ...short,
      payChainKey: ChainKeys.ARBITRUM_MAINNET,
      paySymbol: 'USDC',
      payAmount: 1n,
      settleSymbol: 'USDC',
      appBaseAddress: APP,
    });
    expect(short.approve).toHaveBeenCalledOnce();
  });

  it('throws on a symbol the network does not list', () => {
    expect(() => bySymbol([], 'USDC')).toThrow(/not a supported token/);
  });
});

describe('waitForSettlement', () => {
  const statusSequence = (sodax: Sodax, codes: SolverIntentStatusCode[]) => {
    const spy = vi.spyOn(sodax.swaps, 'getStatus');
    for (const status of codes) spy.mockResolvedValueOnce({ ok: true, value: { status } });
    return spy;
  };

  it('returns solved once getStatus reports SOLVED', async () => {
    const sodax = new Sodax();
    statusSequence(sodax, [SolverIntentStatusCode.NOT_STARTED_YET, SolverIntentStatusCode.SOLVED]);
    await expect(waitForSettlement(sodax, HUB_TX, { intervalMs: 0 })).resolves.toBe('solved');
  });

  it('stops on FAILED instead of polling on', async () => {
    const sodax = new Sodax();
    const spy = statusSequence(sodax, [SolverIntentStatusCode.FAILED]);
    await expect(waitForSettlement(sodax, HUB_TX, { intervalMs: 0 })).resolves.toBe('failed');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('gives up when the budget runs out', async () => {
    vi.useFakeTimers();
    const sodax = new Sodax();
    vi.spyOn(sodax.swaps, 'getStatus').mockResolvedValue({
      ok: true,
      value: { status: SolverIntentStatusCode.STARTED_NOT_FINISHED },
    });
    const outcome = waitForSettlement(sodax, HUB_TX, { budgetMs: 10_000, intervalMs: 2_000 });
    await vi.advanceTimersByTimeAsync(12_000);
    await expect(outcome).resolves.toBe('timed_out');
  });
});
